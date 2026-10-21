import type { Express } from "express";
import multer from "multer";
import { z } from "zod";
import { all, one, run, id, now, audit, localDate, db } from "./db.js";
import { permit, access, invalidate, latest } from "./workflow.js";
import {
  details,
  saveDetails,
  requirements,
  governanceMissing,
  legalReport,
  evidenceLabels,
  humanAxes,
  subtypes,
  modalities,
  documentTypes,
  nextReport,
  reviewDeadline,
} from "./governance.js";
import { paragraphs, demoTemplate, fixed } from "./documents.js";
import { addendumFields } from "../shared/request-policy.js";
import { validateData } from "../shared/data-validation.js";
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
});
function get(req: any) {
  const d = one("SELECT * FROM demands WHERE id=?", req.params.id);
  if (!d) throw Error("Demanda não encontrada.");
  access(req.user, d);
  return d;
}
function mutable(d: any) {
  if (one("SELECT demand_id FROM glpi_intakes WHERE demand_id=? AND confirmed_at IS NULL", d.id)) throw Error("Confira o recebimento GLPI antes de alterar a governança.");
  if (["Concluído", "Cancelado", "Em assinatura"].includes(d.stage))
    throw Error("Esta etapa não permite alterar requisitos ou evidências.");
}
function changed(d: any, user: any, action: string) {
  invalidate(d.id);
  run(
    "UPDATE demands SET data_version=data_version+1,confirmed=0,stage=? WHERE id=?",
    "Em elaboração",
    d.id,
  );
  audit(d.id, user.id, action + "; confirmação e aprovações invalidadas");
}
export function fileInfo(file: any) {
  if (!file) throw Error("Selecione um arquivo.");
  const name = file.originalname.replace(/[\r\n]/g, "").slice(0, 180);
  if (name.toLowerCase().endsWith(".docx")) {
    paragraphs(file.buffer);
    return {
      name,
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
  }
  if (
    name.toLowerCase().endsWith(".pdf") &&
    file.buffer.subarray(0, 5).toString() === "%PDF-"
  )
    return { name, mime: "application/pdf" };
  throw Error(
    "Envie DOCX ou PDF de até 8 MB. PDF é armazenado como evidência, sem conferência automática.",
  );
}
export function registerGovernance(app: Express) {
  app.put("/api/demands/:id/baseline", (req: any, res) => {
    permit(req.user, "confirm");
    const d = get(req);
    mutable(d);
    if (d.type !== "Aditivo")
      throw Error("Retrato anterior disponível apenas para aditivos.");
    const b = z
      .object({
        expected_version: z.number().int(),
        reference: z.string().trim().min(10).max(500),
        attested: z.literal(true),
        data: z.record(z.string(), z.string().trim().max(500)),
      })
      .parse(req.body);
    if (b.expected_version !== d.data_version)
      throw Object.assign(
        Error("A demanda foi alterada. Reabra antes de confirmar o retrato."),
        { status: 409 },
      );
    const keys = addendumFields[details(d).subtype];
    if (!keys) throw Error("Defina primeiro o tipo de aditivo.");
    if (keys.includes("banco")) permit(req.user, "bank");
    if (Object.keys(b.data).some((key) => !keys.includes(key)))
      throw Error("Campo não autorizado no retrato anterior.");
    for (const key of keys.filter((key) => key !== "pix"))
      if (!b.data[key]) throw Error("Preencha o dado atual: " + key);
    const errors = validateData(b.data);
    if (Object.keys(errors).length)
      return res.status(400).json({
        error: "Corrija os dados atuais do contrato.",
        fields: errors,
      });
    db.exec("BEGIN IMMEDIATE");
    try {
      run(
        "INSERT INTO demand_baselines VALUES(?,?,?,?,?,?,?)",
        id(),
        d.id,
        details(d).subtype,
        JSON.stringify(b.data),
        b.reference,
        req.user.id,
        now(),
      );
      changed(
        d,
        req.user,
        "Retrato dos dados atuais confirmado por conferência documental",
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    res.json({ ok: true });
  });
  app.get("/api/governance/catalog", (_req, res) =>
    res.json({
      subtypes,
      modalities,
      documentTypes,
      evidenceLabels,
      humanAxes,
      reportDate: nextReport(),
    }),
  );
  app.get("/api/demands/:id/governance", (req: any, res) => {
    const d = get(req),
      doc = latest(d.id),
      g = details(d);
    const matrix = one("SELECT * FROM contracts WHERE id=?", d.contract_id);
    const report = legalReport(d, doc);
    if (
      !req.user ||
      ![
        "Administrador",
        "Operação",
        "Jurídico",
        "Risco",
        "Financeiro",
        "Aprovador",
      ].includes(req.user.role)
    ) {
      report.findings = report.findings.map((f: any) => ({
        ...f,
        expected: "Restrito",
        found: "Restrito",
      }));
      report.axes = report.axes.map((a: any) => ({
        ...a,
        check: a.check
          ? {
              ...a.check,
              notes: "Conteúdo restrito ao perfil autorizado.",
              issues: [],
            }
          : null,
      }));
    }
    res.json({
      data_version: d.data_version,
      details: g,
      requirements: requirements(d),
      missing: governanceMissing(d),
      evidence: all(
        "SELECT id,kind,name,mime,created,verified_by,verified_at FROM evidence_files WHERE demand_id=? ORDER BY created DESC",
        d.id,
      ),
      history: all(
        "SELECT sequence,source,reference,signature_date,created FROM signed_history WHERE matrix_id=? ORDER BY sequence DESC",
        matrix?.parent_id || JSON.parse(d.data).matriz || d.contract_id,
      ),
      confirmations: all(
        "SELECT sequence,source,reference,signature_date,created FROM history_confirmations WHERE matrix_id=? ORDER BY sequence DESC,created DESC",
        matrix?.parent_id || JSON.parse(d.data).matriz || d.contract_id,
      ),
      report,
    });
  });
  app.put("/api/demands/:id/governance", (req: any, res) => {
    permit(req.user, "write");
    const d = get(req);
    mutable(d);
    if (
      !Number.isInteger(req.body.expected_version) ||
      req.body.expected_version !== d.data_version
    )
      throw Object.assign(
        Error(
          "Conflito de edição: reabra a demanda e revise a governança antes de salvar.",
        ),
        { status: 409 },
      );
    const b = z
      .object({
        subtype: z.enum([...subtypes, ""] as unknown as [string, ...string[]]),
        reportDate: z.iso.date(),
        signingMode: z.enum(["Administrador nomeado", "Todos os sócios"]),
        partnerCount: z.number().int().min(1).max(100),
        signers: z
          .array(
            z.object({
              name: z.string().min(3).max(150),
              email: z.email(),
              capacity: z.enum(["Administrador", "Sócio"]),
            }),
          )
          .min(1)
          .max(100),
        legalFlags: z
          .array(
            z.enum([
              "Alteração do corpo fixo",
              "Alteração societária",
              "Renovação com pendências",
              "Renovação com contratos anteriores",
              "Outro caso jurídico",
            ]),
          )
          .max(10),
      })
      .parse(req.body);
    reviewDeadline(b.reportDate);
    db.exec("BEGIN IMMEDIATE");
    try {
      const updated = run(
        "UPDATE demands SET data_version=data_version+1,confirmed=0,stage='Em elaboração' WHERE id=? AND data_version=?",
        d.id,
        req.body.expected_version,
      );
      if (!updated.changes)
        throw Object.assign(
          Error("Conflito de edição: reabra a demanda e revise a governança."),
          { status: 409 },
        );
      saveDetails(d.id, {
        ...details(d),
        ...b,
        systemLegalFlags: details(d).systemLegalFlags || [],
      });
      invalidate(d.id);
      audit(
        d.id,
        req.user.id,
        "Requisitos e signatários atualizados; confirmação e aprovações invalidadas",
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    res.json({ ok: true });
  });
  app.post("/api/demands/:id/glpi-reference", (req: any, res) => {
    permit(req.user, "write");
    const d = get(req);
    mutable(d);
    const b = z
      .object({
        number: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
        attested: z.literal(true),
      })
      .parse(req.body);
    run("UPDATE demands SET glpi_id=? WHERE id=?", b.number, d.id);
    changed(
      d,
      req.user,
      "Referência GLPI declarada manualmente (sem validação via API)",
    );
    res.json({ ok: true });
  });
  app.post(
    "/api/demands/:id/evidence",
    upload.single("file"),
    (req: any, res) => {
      permit(req.user, "files");
      permit(req.user, "write");
      const d = get(req);
      mutable(d);
      if (!Object.hasOwn(evidenceLabels, req.body.kind))
        throw Error("Tipo de documento não autorizado.");
      const info = fileInfo(req.file);
      run(
        "INSERT INTO evidence_files(id,demand_id,kind,name,mime,bytes,uploaded_by,created) VALUES(?,?,?,?,?,?,?,?)",
        id(),
        d.id,
        req.body.kind,
        info.name,
        info.mime,
        req.file.buffer,
        req.user.id,
        now(),
      );
      changed(
        d,
        req.user,
        "Evidência anexada: " + evidenceLabels[req.body.kind],
      );
      res.json({ ok: true });
    },
  );
  app.post("/api/demands/:id/evidence/:file/verify", (req: any, res) => {
    permit(req.user, "review");
    const d = get(req);
    mutable(d);
    const f = one(
      "SELECT * FROM evidence_files WHERE id=? AND demand_id=?",
      req.params.file,
      d.id,
    );
    if (!f) throw Error("Evidência não encontrada.");
    if (req.body.attested !== true)
      throw Error("Confirme a leitura e a adequação do documento.");
    run(
      "UPDATE evidence_files SET verified_by=?,verified_at=? WHERE id=?",
      req.user.id,
      now(),
      f.id,
    );
    changed(
      d,
      req.user,
      "Evidência verificada por pessoa responsável: " + evidenceLabels[f.kind],
    );
    res.json({ ok: true });
  });
  app.get("/api/demands/:id/evidence/:file/download", (req: any, res) => {
    permit(req.user, "files");
    permit(req.user, "bank");
    const d = get(req);
    const f = one(
      "SELECT * FROM evidence_files WHERE id=? AND demand_id=?",
      req.params.file,
      d.id,
    );
    if (!f) throw Error("Evidência não encontrada.");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.type(f.mime).attachment(f.name).send(Buffer.from(f.bytes));
    audit(d.id, req.user.id, "Download de evidência autorizado");
  });
  app.post("/api/contracts/:id/signed-history", (req: any, res) => {
    permit(req.user, "risk");
    const matrix = one(
      "SELECT * FROM contract_registry WHERE id=?",
      req.params.id,
    );
    if (
      !matrix ||
      matrix.instrument_kind !== "Matriz" ||
      matrix.status !== "Assinado"
    )
      throw Error("Selecione contrato matriz assinado.");
    const b = z
      .object({
        sequence: z.number().int().min(0).max(100000),
        source: z.enum(["Clicksign", "Clint"]),
        reference: z.string().min(5).max(300),
        signatureDate: z.iso.date(),
        attested: z.literal(true),
      })
      .parse(req.body);
    if (b.signatureDate > localDate())
      throw Error("Data de assinatura não pode estar no futuro.");
    const max = one(
      "SELECT MAX(sequence) n FROM signed_history WHERE matrix_id=?",
      matrix.id,
    ).n;
    if (max !== null && b.sequence < max)
      throw Error(
        "Histórico confirmado não pode retroceder. A reconferência do mesmo número fica registrada separadamente.",
      );
    if (
      !one(
        "SELECT id FROM signed_history WHERE matrix_id=? AND sequence=?",
        matrix.id,
        b.sequence,
      )
    )
      run(
        "INSERT INTO signed_history VALUES(?,?,?,?,?,?,?,?)",
        id(),
        matrix.id,
        b.sequence,
        b.source,
        b.reference,
        b.signatureDate,
        req.user.id,
        now(),
      );
    run(
      "INSERT OR IGNORE INTO history_confirmations VALUES(?,?,?,?,?,?,?,?)",
      id(),
      matrix.id,
      b.sequence,
      b.source,
      b.reference,
      b.signatureDate,
      req.user.id,
      now(),
    );
    audit(
      null,
      req.user.id,
      "Histórico assinado confirmado manualmente: matriz " + matrix.id,
    );
    res.json({ ok: true });
  });
  app.post("/api/demands/:id/human-check", (req: any, res) => {
    permit(req.user, "review");
    const d = get(req),
      doc = latest(d.id);
    if (!doc || doc.data_version !== d.data_version)
      throw Error("Gere ou anexe a versão atual antes de revisar.");
    mutable(d);
    const b = z
      .object({
        axis: z.enum(humanAxes as [string, ...string[]]),
        result: z.enum(["Aprovado", "Aprovado com ressalvas", "Reprovado"]),
        notes: z.string().min(10).max(3000),
        issues: z
          .array(
            z.object({
              location: z.string().min(3).max(300),
              problem: z.string().min(3).max(1000),
              correction: z.string().min(3).max(1000),
              severity: z.enum(["menor", "crítica"]),
            }),
          )
          .max(30)
          .default([]),
      })
      .parse(req.body);
    if (b.result !== "Aprovado" && !b.issues.length)
      throw Error(
        "Informe localização, problema e correção para cada ressalva ou reprovação.",
      );
    if (
      b.issues.some((i) => i.severity === "crítica") &&
      b.result !== "Reprovado"
    )
      throw Error(
        "Ocorrências críticas exigem reprovação, não aprovação com ressalvas.",
      );
    if (b.result === "Aprovado" && b.issues.length)
      throw Error(
        "Com ocorrências, selecione aprovação com ressalvas ou reprovação.",
      );
    if (
      ["Assinaturas", "Tipo e autorização"].includes(b.axis) &&
      !["Administrador", "Jurídico", "Risco"].includes(req.user.role)
    )
      throw Object.assign(Error("Este eixo exige Risco ou Jurídico."), {
        status: 403,
      });
    if (b.result !== "Aprovado") invalidate(d.id);
    const checkId = id();
    run(
      "INSERT INTO human_checks VALUES(?,?,?,?,?,?,?,?)",
      checkId,
      doc.id,
      d.data_version,
      b.axis,
      b.result,
      b.notes,
      req.user.id,
      now(),
    );
    for (const issue of b.issues)
      run(
        "INSERT INTO human_issues VALUES(?,?,?,?,?,?)",
        id(),
        checkId,
        issue.location,
        issue.problem,
        issue.correction,
        issue.severity,
      );
    if (b.result === "Reprovado")
      run("UPDATE demands SET stage=? WHERE id=?", "Devolvido", d.id);
    audit(
      d.id,
      req.user.id,
      `Revisão humana: ${b.axis} — ${b.result}; ${b.issues.length} ocorrências registradas`,
    );
    res.json({ ok: true });
  });
  /** Attaching the signed file and closing the GLPI ticket stay external while access is read-only. */
  app.post("/api/demands/:id/glpi-closure", (req: any, res) => {
    permit(req.user, "write");
    const d = get(req);
    if (d.stage !== "Concluído")
      throw Error(
        "Registre o encerramento no GLPI somente após a conclusão local com documento assinado.",
      );
    const b = z
      .object({
        attested: z.literal(true),
        note: z.string().trim().min(5).max(500),
      })
      .parse(req.body);
    const g = details(d);
    if (g.glpiClosure) throw Error("Encerramento no GLPI já registrado.");
    saveDetails(d.id, {
      ...g,
      glpiClosure: {
        by: req.user.id,
        name: req.user.name,
        at: now(),
        note: b.note,
      },
    });
    audit(
      d.id,
      req.user.id,
      "Anexação do assinado e encerramento do chamado no GLPI declarados manualmente (sem escrita via API): " +
        b.note,
    );
    res.json({ ok: true });
  });
  app.get("/api/demands/:id/legal-report", (req: any, res) => {
    permit(req.user, "files");
    permit(req.user, "bank");
    const d = get(req);
    const r = legalReport(d, latest(d.id));
    const text = [
      r.title,
      "Documento: " + r.document,
      "Data: " + r.date,
      `Versão documental: ${r.documentVersion} | Dados: ${r.dataVersion}`,
      "STATUS GERAL: " + r.status,
      ...r.axes.flatMap((a: any) => [
        "\n" + a.axis.toUpperCase(),
        a.check
          ? `${a.check.result}: ${a.check.notes}\nResponsável: ${a.check.name} | ${a.check.created}`
          : "Revisão humana pendente.",
        ...(a.check?.issues || []).map(
          (i: any) =>
            `${i.location} → ${i.problem} → ${i.correction} (${i.severity})`,
        ),
      ]),
      "\nDIVERGÊNCIAS ESTRUTURAIS",
      ...r.findings.map(
        (f: any) =>
          `${f.location}: ${f.field}\nEsperado: ${f.expected}\nEncontrado: ${f.found}\nCorreção: ${f.guidance}`,
      ),
      "\nPENDÊNCIAS PARA REGULARIZAR",
      ...r.missing.map((m: string, i: number) => `${i + 1}. ${m}`),
      "\n" + r.disclaimer,
    ].join("\n");
    res
      .type("text/plain; charset=utf-8")
      .attachment("revisao-" + d.id + ".txt")
      .send(text);
  });
}
export function seedCatalog() {
  if (process.env.NODE_ENV === "production" || process.env.DEMO_SEED !== "true")
    return;
  if (one("SELECT value FROM settings WHERE key='demoDisabled'")?.value === "true") return;
  run(
    "INSERT OR IGNORE INTO template_catalog VALUES(?,?,?,?)",
    "tv1",
    "Contrato de garantia",
    "",
    1,
  );
  for (const [i, subtype] of subtypes.entries()) {
    const tid = "t-aditivo-" + i,
      vid = "tv-aditivo-" + i;
    if (one("SELECT id FROM templates WHERE id=?", tid)) continue;
    run(
      "INSERT INTO templates VALUES(?,?,?)",
      tid,
      "DEMONSTRAÇÃO — Aditivo de " + subtype,
      "Aditivo",
    );
    run(
      "INSERT INTO template_versions VALUES(?,?,?,?,?,?,?)",
      vid,
      tid,
      1,
      "aprovado",
      fixed,
      demoTemplate("Aditivo de " + subtype),
      "u0",
    );
    run(
      "INSERT INTO template_catalog VALUES(?,?,?,?)",
      vid,
      "Aditivo",
      subtype,
      1,
    );
  }
  run(
    "INSERT OR IGNORE INTO template_catalog VALUES(?,?,?,?)",
    "tv1",
    "Contrato de garantia",
    "",
    1,
  );
  const seeds = [
    {
      tid: "t1",
      type: "Contrato de garantia",
      subtype: "",
      bytes: demoTemplate(),
    },
    ...subtypes.map((subtype, i) => ({
      tid: "t-aditivo-" + i,
      type: "Aditivo",
      subtype,
      bytes: demoTemplate("Aditivo de " + subtype),
    })),
  ];
  for (const seed of seeds) {
    const previous = one(
      "SELECT v.*,c.demonstration FROM template_versions v JOIN template_catalog c ON c.version_id=v.id WHERE template_id=? ORDER BY version DESC LIMIT 1",
      seed.tid,
    );
    if (
      !previous ||
      !previous.demonstration ||
      JSON.stringify(paragraphs(Buffer.from(previous.bytes))) ===
        JSON.stringify(paragraphs(seed.bytes))
    )
      continue;
    const versionId = id();
    run(
      "INSERT INTO template_versions VALUES(?,?,?,?,?,?,?)",
      versionId,
      seed.tid,
      previous.version + 1,
      "aprovado",
      fixed,
      seed.bytes,
      "u0",
    );
    run(
      "INSERT INTO template_catalog VALUES(?,?,?,?)",
      versionId,
      seed.type,
      seed.subtype,
      1,
    );
    run(
      "INSERT OR IGNORE INTO inactive_template_versions VALUES(?,?,?)",
      previous.id,
      "u0",
      now(),
    );
    audit(
      null,
      "u0",
      "Nova versão do modelo demonstrativo; versão anterior preservada",
    );
  }
}
