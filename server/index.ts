import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import multer from "multer";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import {
  db,
  all,
  one,
  run,
  id,
  now,
  verify,
  audit,
  hash,
  localDate,
} from "./db.js";
import "./seed.js";
import { fields, generate, review, paragraphs } from "./documents.js";
import {
  permissions,
  permit,
  access,
  required,
  latest,
  invalidate,
  transition,
  allocateAddendum,
  stages,
  saveTerms,
} from "./workflow.js";
import {
  DemoGlpiAdapter,
  UnconfiguredGlpiAdapter,
  importPages,
  GlpiTicket,
} from "./integrations.js";
import { basisPoints, cents } from "./decimal.js";
import { allowedOrigin } from "./origins.js";
import {
  registerGovernance,
  seedCatalog,
  fileInfo,
} from "./governance-routes.js";
import {
  details,
  saveDetails,
  requirements,
  humanMissing,
  documentTypes,
  matrixCases,
  nextReport,
  legalReport,
} from "./governance.js";
seedCatalog();
const app = express();
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use("/api", (req, res, next) => {
  if (
    !["GET", "HEAD"].includes(req.method) &&
    req.headers.origin &&
    !allowedOrigin(req.headers.origin)
  )
    return res.status(403).json({
      error:
        "Endereço de acesso não autorizado. Em desenvolvimento, abra pelo localhost ou 127.0.0.1. Para um domínio próprio, configure ALLOWED_ORIGINS no servidor.",
    });
  next();
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});
app.post(
  "/api/login",
  rateLimit({ windowMs: 900000, limit: 20 }),
  (req, res) => {
    const u = one("SELECT * FROM users WHERE email=?", String(req.body.email));
    if (!u || !verify(String(req.body.password), u.password))
      return res.status(401).json({ error: "E-mail ou senha inválidos." });
    const token = randomBytes(32).toString("hex");
    run(
      "INSERT INTO sessions VALUES(?,?,?)",
      token,
      u.id,
      Date.now() + 8 * 3600000,
    );
    res.cookie("session", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      maxAge: 8 * 3600000,
    });
    res.json({
      id: u.id,
      name: u.name,
      role: u.role,
      permissions: permissions[u.role],
    });
  },
);
app.use("/api", (req: any, res, next) => {
  const u = one(
    "SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires>?",
    req.cookies.session || "",
    Date.now(),
  );
  if (!u)
    return res
      .status(401)
      .json({ error: "Entre na sua conta para continuar." });
  req.user = u;
  next();
});
app.post("/api/logout", (req, res) => {
  run("DELETE FROM sessions WHERE token=?", req.cookies.session || "");
  res.clearCookie("session");
  res.json({ ok: true });
});
app.get("/api/me", (req: any, res) =>
  res.json({
    id: req.user.id,
    name: req.user.name,
    role: req.user.role,
    permissions: permissions[req.user.role],
  }),
);
registerGovernance(app);
function demand(req: any) {
  const d = one("SELECT * FROM demands WHERE id=?", req.params.id);
  if (!d)
    throw Object.assign(Error("Demanda não encontrada."), { status: 404 });
  access(req.user, d);
  return d;
}
function safeData(user: any, data: any) {
  if (!permissions[user.role].includes("bank"))
    for (const f of ["banco", "agencia", "conta"]) delete data[f];
  return data;
}
app.get("/api/bootstrap", (req: any, res) => {
  const where = req.user.role === "Solicitante" ? " WHERE d.owner=?" : "";
  const demands = all(
    `SELECT d.*,s.name AS school,s.cnpj,u.name AS owner_name FROM demands d JOIN schools s ON s.id=d.school_id JOIN users u ON u.id=d.owner${where} ORDER BY d.created DESC`,
    ...(where ? [req.user.id] : []),
  ).map((d) => ({ ...d, data: safeData(req.user, JSON.parse(d.data)) }));
  const terminal = ["Concluído", "Cancelado"];
  const open = demands.filter((d) => !terminal.includes(d.stage));
  const completed = demands.filter(
    (d) =>
      d.stage === "Concluído" &&
      d.completed &&
      localDate(d.completed).slice(0, 7) === localDate().slice(0, 7),
  );
  res.json({
    demands,
    schools: all("SELECT * FROM schools"),
    contracts: all(
      "SELECT c.*,s.name AS school FROM contracts c JOIN schools s ON s.id=c.school_id",
    ),
    users: all("SELECT id,name,role,email FROM users"),
    templates: all(
      "SELECT t.*,c.document_type,c.subtype,c.demonstration,v.id AS version_id,v.version,CASE WHEN EXISTS(SELECT 1 FROM inactive_template_versions iv WHERE iv.version_id=v.id) THEN 'inativo' ELSE v.status END AS status FROM templates t JOIN template_versions v ON v.template_id=t.id LEFT JOIN template_catalog c ON c.version_id=v.id",
    ),
    sync: all("SELECT * FROM sync_logs ORDER BY created DESC LIMIT 20"),
    settings: all(
      "SELECT * FROM settings WHERE key IN ('legalPolicies','glpiMapping')",
    ),
    metrics: {
      open: open.length,
      overdue: open.filter((d) => d.due < localDate()).length,
      approval: demands.filter((d) => d.stage === "Em aprovação").length,
      signature: demands.filter((d) => d.stage === "Em assinatura").length,
      completed: completed.length,
      average: completed.length
        ? Math.round(
            completed.reduce(
              (s, d) =>
                s +
                (Date.parse(d.completed) - Date.parse(d.created)) / 86400000,
              0,
            ) / completed.length,
          )
        : 0,
    },
  });
});
const schoolSchema = z.object({
  name: z.string().min(3),
  legal_name: z.string().min(3),
  cnpj: z.string().regex(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/),
  address: z.string().max(500),
  contact: z.string().max(200),
});
app.post("/api/schools", (req: any, res) => {
  permit(req.user, "write");
  const data = schoolSchema.parse(req.body);
  const sid = id();
  run(
    "INSERT INTO schools VALUES(?,?,?,?,?,?)",
    sid,
    data.name,
    data.legal_name,
    data.cnpj,
    data.address,
    data.contact,
  );
  audit(null, req.user.id, "Escola criada");
  res.json({ id: sid });
});
app.put("/api/schools/:id", (req: any, res) => {
  permit(req.user, "write");
  const data = schoolSchema.parse(req.body);
  const active = one(
    "SELECT id FROM demands WHERE school_id=? AND stage NOT IN (?,?)",
    req.params.id,
    "Concluído",
    "Cancelado",
  );
  if (active)
    throw Error(
      "Há demandas abertas: conclua ou cancele antes de alterar os dados cadastrais da escola.",
    );
  run(
    "UPDATE schools SET name=?,legal_name=?,cnpj=?,address=?,contact=? WHERE id=?",
    data.name,
    data.legal_name,
    data.cnpj,
    data.address,
    data.contact,
    req.params.id,
  );
  audit(null, req.user.id, "Escola atualizada");
  res.json({ ok: true });
});
app.get("/api/schools/:id", (req: any, res) =>
  res.json({
    school: one("SELECT * FROM schools WHERE id=?", req.params.id),
    representatives: all(
      "SELECT * FROM representatives WHERE school_id=?",
      req.params.id,
    ),
  }),
);
app.post("/api/schools/:id/representatives", (req: any, res) => {
  permit(req.user, "write");
  const data = z
    .object({ name: z.string().min(3), email: z.email() })
    .parse(req.body);
  run(
    "INSERT INTO representatives VALUES(?,?,?,?)",
    id(),
    req.params.id,
    data.name,
    data.email,
  );
  res.json({ ok: true });
});
const demandSchema = z.object({
  school_id: z.string(),
  type: z.enum(documentTypes as [string, ...string[]]),
  glpi_id: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,80}$/)
    .optional(),
  subtype: z.string().optional(),
  owner: z.string(),
  priority: z.enum(["Normal", "Alta", "Urgente"]),
  due: z.iso.date(),
  matrix: z.string().optional(),
});
app.post("/api/demands", (req: any, res) => {
  permit(req.user, "write");
  const b = demandSchema.parse(req.body),
    s = one("SELECT * FROM schools WHERE id=?", b.school_id);
  if (!s) throw Error("Escola inválida.");
  if (
    matrixCases.includes(b.type) &&
    !one(
      "SELECT id FROM contracts WHERE id=? AND school_id=? AND parent_id IS NULL AND status='Assinado'",
      b.matrix || "",
      s.id,
    )
  )
    throw Error(
      "Esta operação jurídica exige vínculo com contrato matriz assinado da escola.",
    );
  if (
    !one(
      "SELECT id FROM users WHERE id=?",
      req.user.role === "Solicitante" ? req.user.id : b.owner,
    )
  )
    throw Error("Responsável inválido.");
  if (b.glpi_id && one("SELECT id FROM demands WHERE glpi_id=?", b.glpi_id))
    throw Error("O chamado GLPI já está vinculado a uma demanda.");
  if (
    b.matrix &&
    !one(
      "SELECT id FROM contracts WHERE id=? AND school_id=? AND parent_id IS NULL",
      b.matrix,
      s.id,
    )
  )
    throw Error("O contrato matriz deve pertencer à escola selecionada.");
  db.exec("BEGIN IMMEDIATE");
  try {
    let cid = id(),
      seq;
    if (b.type === "Aditivo") {
      const c = allocateAddendum(s.id, b.matrix || "", false);
      cid = c.id;
      seq = c.sequence;
    } else run("INSERT INTO contracts(id,school_id) VALUES(?,?)", cid, s.id);
    const did = "KD-" + id().slice(0, 8).toUpperCase();
    run(
      "INSERT INTO demands(id,school_id,contract_id,type,stage,priority,owner,due,data,created) VALUES(?,?,?,?,?,?,?,?,?,?)",
      did,
      s.id,
      cid,
      b.type,
      "Recebido",
      b.priority,
      req.user.role === "Solicitante" ? req.user.id : b.owner,
      b.due,
      JSON.stringify({
        cnpj: s.cnpj,
        razaoSocial: s.legal_name,
        matriz: b.matrix || cid,
        aditivo: seq ? String(seq) : "Não aplicável",
        checklist: false,
      }),
      now(),
    );
    audit(did, req.user.id, "Demanda criada manualmente");
    if (b.glpi_id)
      run("UPDATE demands SET glpi_id=? WHERE id=?", b.glpi_id, did);
    saveDetails(did, {
      subtype: b.subtype || "",
      reportDate: nextReport(),
      signers: [],
      legalFlags: [],
    });
    db.exec("COMMIT");
    res.json({ id: did });
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
});
app.get("/api/demands/:id", (req: any, res) => {
  const d = demand(req);
  const docs = all(
    "SELECT id,version,template_version,data_version,created,signed IS NOT NULL AS is_signed FROM documents WHERE demand_id=? ORDER BY version DESC",
    d.id,
  );
  const reviews = all(
    "SELECT r.* FROM reviews r JOIN documents doc ON doc.id=r.document_id WHERE doc.demand_id=? ORDER BY r.created DESC",
    d.id,
  ).map((r) => ({
    ...r,
    results: JSON.parse(r.results).map((v: any) =>
      permissions[req.user.role].includes("bank")
        ? v
        : ["banco", "agencia", "conta"].includes(v.field)
          ? { ...v, expected: "Restrito", found: "Restrito" }
          : v,
    ),
  }));
  res.json({
    ...d,
    data: safeData(req.user, JSON.parse(d.data)),
    missing: required(d),
    requirements: requirements(d),
    documents: docs,
    reviews,
    approvals: all(
      "SELECT a.*,u.name FROM approvals a JOIN documents d ON d.id=a.document_id JOIN users u ON u.id=a.user_id WHERE d.demand_id=?",
      d.id,
    ),
    history: all(
      "SELECT a.*,u.name FROM audit a LEFT JOIN users u ON u.id=a.user_id WHERE demand_id=? ORDER BY created DESC",
      d.id,
    ),
  });
});
const percent = /^(?:\d{1,2}|100),\d{2}%$/;
app.put("/api/demands/:id/data", (req: any, res) => {
  permit(req.user, "write");
  const d = demand(req);
  if (["Concluído", "Cancelado", "Em assinatura"].includes(d.stage))
    throw Error("Esta etapa não permite alteração de dados.");
  const incoming = z
    .record(z.string(), z.union([z.string().max(500), z.boolean()]))
    .parse(req.body);
  const existing = JSON.parse(d.data);
  for (const [key, value] of Object.entries(incoming)) {
    if (![...fields, "checklist"].includes(key))
      throw Error("Campo não autorizado.");
    if (key !== "checklist" && typeof value !== "string")
      throw Error("O campo deve conter texto: " + key);
    if (key === "checklist" && typeof value !== "boolean")
      throw Error("Confirmação documental inválida.");
    if (["matriz", "aditivo"].includes(key) && value !== existing[key])
      throw Error(
        "Matriz e sequência são reservadas pelo sistema e não podem ser alteradas.",
      );
    if (["banco", "agencia", "conta"].includes(key)) permit(req.user, "bank");
    if (
      ["remuneracao", "garantia", "repasse", "cashback"].includes(key) &&
      value &&
      !percent.test(String(value))
    )
      throw Error("Percentual inválido. Use 7,70% (de 0 a 100).");
    if (
      ["remuneracao", "garantia", "repasse", "cashback"].includes(key) &&
      value
    )
      basisPoints(String(value));
    if (key === "valor" && value) cents(String(value));
    if (
      [
        "inicio",
        "fim",
        "dataRepasse",
        "dataAssinaturaMatriz",
        "dataFormalizacao",
      ].includes(key) &&
      value &&
      !z.iso.date().safeParse(value).success
    )
      throw Error("Data inválida.");
    existing[key] = value;
  }
  if (existing.inicio && existing.fim && existing.inicio > existing.fim)
    throw Error("Fim da vigência deve ser posterior ao início.");
  saveTerms(d.id, existing);
  invalidate(d.id);
  run(
    "UPDATE demands SET data=?,data_version=data_version+1,confirmed=0,stage=? WHERE id=?",
    JSON.stringify(existing),
    "Em elaboração",
    d.id,
  );
  audit(
    d.id,
    req.user.id,
    "Dados alterados; confirmação e aprovações invalidadas",
  );
  res.json({ ok: true });
});
app.post("/api/demands/:id/confirm", (req: any, res) => {
  permit(req.user, "confirm");
  const d = demand(req);
  if (required(d).length)
    throw Error("Preencha os campos e confirme a documentação obrigatória.");
  run("UPDATE demands SET confirmed=1 WHERE id=?", d.id);
  audit(d.id, req.user.id, "Dados críticos confirmados por pessoa responsável");
  res.json({ ok: true });
});
app.post("/api/demands/:id/stage", (req: any, res) => {
  const d = demand(req);
  transition(req.user, d, String(req.body.stage), req.body.reason);
  res.json({ ok: true });
});
app.post("/api/demands/:id/generate", (req: any, res) => {
  permit(req.user, "write");
  permit(req.user, "bank");
  const d = demand(req);
  if (!d.confirmed || required(d).length)
    throw Error("Confirme os dados completos antes da geração.");
  if (!["Em elaboração", "Em conferência"].includes(d.stage))
    throw Error("Geração disponível em elaboração ou conferência.");
  const t = one(
    "SELECT * FROM template_versions WHERE id=? AND status=? AND id NOT IN (SELECT version_id FROM inactive_template_versions)",
    req.body.template_version || "tv1",
    "aprovado",
  );
  if (!t) throw Error("Selecione uma versão aprovada.");
  const bytes = generate(Buffer.from(t.bytes), JSON.parse(d.data));
  const catalog = one(
    "SELECT * FROM template_catalog WHERE version_id=?",
    t.id,
  );
  if (catalog?.demonstration && process.env.NODE_ENV === "production")
    throw Error(
      "Modelos demonstrativos não podem gerar documentos em produção. Cadastre e aprove o modelo oficial.",
    );
  if (
    !catalog ||
    catalog.document_type !== d.type ||
    (d.type === "Aditivo" && catalog.subtype !== details(d).subtype)
  )
    throw Error(
      "O modelo não corresponde ao tipo/subtipo desta demanda. Cadastre e aprove a versão correta.",
    );
  const docid = id();
  const version = (latest(d.id)?.version || 0) + 1;
  invalidate(d.id);
  run(
    "INSERT INTO documents VALUES(?,?,?,?,?,?,?,?,?,?)",
    docid,
    d.id,
    version,
    t.id,
    d.data_version,
    d.data,
    bytes,
    null,
    req.user.id,
    now(),
  );
  run("UPDATE demands SET stage=? WHERE id=?", "Em conferência", d.id);
  audit(
    d.id,
    req.user.id,
    `Minuta v${version} gerada com modelo v${t.version}`,
  );
  res.json({ id: docid });
});
function checkedFile(req: any) {
  if (!req.file || !req.file.originalname.toLowerCase().endsWith(".docx"))
    throw Error("Envie um arquivo DOCX de até 5 MB.");
  paragraphs(req.file.buffer);
  return req.file.buffer;
}
app.post("/api/demands/:id/upload", upload.single("file"), (req: any, res) => {
  permit(req.user, "files");
  permit(req.user, "write");
  const d = demand(req),
    previous = latest(d.id);
  if (
    ![
      "Recebido",
      "Em elaboração",
      "Em conferência",
      "Em aprovação",
      "Devolvido",
    ].includes(d.stage)
  )
    throw Error("Gere uma minuta e envie a revisão antes da assinatura.");
  const bytes = checkedFile(req);
  if (!d.glpi_id)
    throw Error("Registre a referência GLPI antes de anexar a minuta.");
  const selected = previous?.template_version || req.body.template_version;
  const template = one(
    "SELECT v.*,c.document_type,c.subtype FROM template_versions v JOIN template_catalog c ON c.version_id=v.id WHERE v.id=? AND v.status=? AND v.id NOT IN(SELECT version_id FROM inactive_template_versions)",
    selected,
    "aprovado",
  );
  if (
    !template ||
    template.document_type !== d.type ||
    (d.type === "Aditivo" && template.subtype !== details(d).subtype)
  )
    throw Error("Selecione um modelo aprovado correspondente ao documento.");
  invalidate(d.id);
  run(
    "INSERT INTO documents VALUES(?,?,?,?,?,?,?,?,?,?)",
    id(),
    d.id,
    (previous?.version || 0) + 1,
    template.id,
    d.data_version,
    d.data,
    bytes,
    null,
    req.user.id,
    now(),
  );
  run("UPDATE demands SET stage=? WHERE id=?", "Em conferência", d.id);
  audit(d.id, req.user.id, "Nova versão DOCX anexada; aprovações invalidadas");
  res.json({ ok: true });
});
app.post("/api/demands/:id/review", (req: any, res) => {
  permit(req.user, "review");
  const d = demand(req),
    doc = latest(d.id);
  if (!doc || doc.data_version !== d.data_version)
    throw Error("Gere a minuta atual.");
  const template = one(
    "SELECT * FROM template_versions WHERE id=?",
    doc.template_version,
  );
  const r = review(
    Buffer.from(doc.bytes),
    JSON.parse(doc.snapshot),
    Buffer.from(template.bytes),
  );
  run(
    "INSERT INTO reviews VALUES(?,?,?,?,?,?)",
    id(),
    doc.id,
    r.status,
    JSON.stringify(r.results),
    req.user.id,
    now(),
  );
  audit(d.id, req.user.id, "Conferência: " + r.status);
  if (r.results.some((f: any) => f.field === "Corpo fixo")) {
    const g = details(d);
    saveDetails(d.id, {
      ...g,
      systemLegalFlags: Array.from(
        new Set([...(g.systemLegalFlags || []), "Alteração do corpo fixo"]),
      ),
    });
    audit(
      d.id,
      req.user.id,
      "Controle jurídico obrigatório por alteração estrutural do corpo fixo",
    );
  }
  if (r.status !== "conforme") {
    invalidate(d.id);
    run("UPDATE demands SET stage=? WHERE id=?", "Devolvido", d.id);
    audit(d.id, req.user.id, "Devolução automática: conferência " + r.status);
  }
  res.json(r);
});
app.post("/api/demands/:id/approve", (req: any, res) => {
  const kind = z
    .enum(["Comercial", "Jurídica", "Risco", "Financeiro"])
    .parse(req.body.kind);
  permit(
    req.user,
    (
      {
        Comercial: "commercial",
        Jurídica: "legal",
        Risco: "risk",
        Financeiro: "finance",
      } as Record<string, string>
    )[kind],
  );
  const d = demand(req),
    doc = latest(d.id);
  if (
    d.stage !== "Em aprovação" ||
    !doc ||
    !d.confirmed ||
    doc.data_version !== d.data_version ||
    required(d).length
  )
    throw Error("A demanda não está pronta para aprovação.");
  const r = one(
    "SELECT * FROM reviews WHERE document_id=? ORDER BY created DESC LIMIT 1",
    doc.id,
  );
  if (r?.status !== "conforme")
    throw Error("Conferência conforme obrigatória.");
  if (humanMissing(doc).length)
    throw Error("Complete os cinco eixos da revisão humana.");
  const deadline = requirements(d).reviewDeadline;
  if (
    deadline &&
    deadline < localDate() &&
    (!req.body.delayReason || String(req.body.delayReason).trim().length < 10)
  )
    throw Error(
      "Prazo da quinta-feira ultrapassado. Registre justificativa de atraso com pelo menos 10 caracteres.",
    );
  run(
    "INSERT INTO approvals VALUES(?,?,?,?,?,?,?)",
    id(),
    doc.id,
    d.data_version,
    kind,
    req.user.id,
    now(),
    1,
  );
  audit(d.id, req.user.id, "Aprovação " + kind + " da minuta v" + doc.version);
  if (deadline && deadline < localDate())
    audit(
      d.id,
      req.user.id,
      "Validação fora do prazo semanal: " + String(req.body.delayReason),
    );
  res.json({ ok: true });
});
app.post(
  "/api/demands/:id/signature",
  upload.single("file"),
  (req: any, res) => {
    permit(req.user, "files");
    permit(req.user, "write");
    const d = demand(req),
      doc = latest(d.id);
    if (d.stage !== "Em assinatura" || !doc)
      throw Error("Envie para assinatura após as aprovações.");
    if (doc.signed)
      throw Error(
        "Documento assinado já registrado. Não é permitido substituir silenciosamente.",
      );
    if (req.body.attested !== "true")
      throw Error(
        "Confirme que o arquivo corresponde à versão aprovada e contém as assinaturas exigidas.",
      );
    const info = fileInfo(req.file);
    const bytes = req.file.buffer;
    if (required(d).length || humanMissing(doc).length)
      throw Error("Requisitos/revisão humana pendentes.");
    for (const kind of requirements(d).approvals)
      if (
        !one(
          "SELECT id FROM approvals WHERE document_id=? AND data_version=? AND kind=? AND valid=1",
          doc.id,
          d.data_version,
          kind,
        )
      )
        throw Error("Validação pendente: " + kind);
    run(
      "INSERT INTO signature_records VALUES(?,?,?,?,?,?)",
      doc.id,
      info.mime,
      info.name,
      req.user.id,
      now(),
      1,
    );
    run("UPDATE documents SET signed=? WHERE id=?", bytes, doc.id);
    audit(
      d.id,
      req.user.id,
      "Documento assinado registrado manualmente; autenticidade não verificada",
    );
    res.json({ ok: true });
  },
);
app.get("/api/documents/:id/download", (req: any, res) => {
  permit(req.user, "files");
  permit(req.user, "bank");
  const doc = one("SELECT * FROM documents WHERE id=?", req.params.id);
  if (!doc) throw Error("Documento não encontrado.");
  access(req.user, one("SELECT * FROM demands WHERE id=?", doc.demand_id));
  const bytes = req.query.signed === "1" ? doc.signed : doc.bytes;
  if (!bytes) throw Error("Documento assinado não registrado.");
  audit(doc.demand_id, req.user.id, "Download autorizado de documento");
  const info =
    req.query.signed === "1"
      ? one("SELECT * FROM signature_records WHERE document_id=?", doc.id)
      : null;
  res
    .type(
      info?.mime ||
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    .attachment(info?.name || `kedu-${doc.id}.docx`)
    .send(Buffer.from(bytes));
});
app.post("/api/templates", upload.single("file"), (req: any, res) => {
  permit(req.user, "settings");
  const bytes = checkedFile(req);
  const text = paragraphs(bytes).join("\n");
  for (const m of text.matchAll(/\{([^}]+)\}/g))
    if (!fields.includes(m[1])) throw Error("Variável não autorizada: " + m[1]);
  const tid = req.body.template_id || id();
  const documentType = z
    .enum(documentTypes as [string, ...string[]])
    .parse(req.body.document_type || "Contrato de garantia");
  const subtype = req.body.subtype || "";
  if (
    documentType === "Aditivo" &&
    ![
      "Conta bancária",
      "Vigência",
      "Percentual/data de repasse",
      "Cashback",
      "Taxa de remuneração",
    ].includes(subtype)
  )
    throw Error("Selecione o tipo específico de aditivo.");
  if (!req.body.template_id)
    run(
      "INSERT INTO templates VALUES(?,?,?)",
      tid,
      z.string().min(3).parse(req.body.name),
      "Contrato",
    );
  const version = one(
    "SELECT COALESCE(MAX(version),0)+1 n FROM template_versions WHERE template_id=?",
    tid,
  ).n;
  const versionId = id();
  run(
    "INSERT INTO template_versions VALUES(?,?,?,?,?,?,?)",
    versionId,
    tid,
    version,
    "rascunho",
    text,
    bytes,
    null,
  );
  run(
    "INSERT INTO template_catalog VALUES(?,?,?,?)",
    versionId,
    documentType,
    subtype,
    req.body.demonstration === "false" ? 0 : 1,
  );
  audit(null, req.user.id, "Modelo DOCX cadastrado como rascunho");
  res.json({ ok: true });
});
app.post("/api/templates/:id/approve", (req: any, res) => {
  permit(req.user, "legal");
  run(
    "UPDATE template_versions SET status=?,approved_by=? WHERE id=? AND status=?",
    "aprovado",
    req.user.id,
    req.params.id,
    "rascunho",
  );
  audit(null, req.user.id, "Versão de modelo aprovada");
  res.json({ ok: true });
});
app.post("/api/templates/:id/deactivate", (req: any, res) => {
  permit(req.user, "settings");
  if (!one("SELECT id FROM template_versions WHERE id=?", req.params.id))
    throw Error("Modelo não encontrado.");
  run(
    "INSERT OR IGNORE INTO inactive_template_versions VALUES(?,?,?)",
    req.params.id,
    req.user.id,
    now(),
  );
  audit(
    null,
    req.user.id,
    "Versão de modelo inativada sem alterar seu conteúdo",
  );
  res.json({ ok: true });
});
app.post("/api/settings", (req: any, res) => {
  permit(req.user, "settings");
  const b = z
    .object({
      key: z.enum(["glpiMapping", "legalPolicies"]),
      value: z.string().max(3000),
    })
    .parse(req.body);
  const config = JSON.parse(b.value);
  if (b.key === "legalPolicies") {
    z.array(z.string().min(3).max(150)).max(30).parse(config);
    if (
      one("SELECT value FROM settings WHERE key=?", b.key)?.value !== b.value
    ) {
      run(
        "UPDATE approvals SET valid=0 WHERE document_id IN(SELECT doc.id FROM documents doc JOIN demands d ON d.id=doc.demand_id WHERE d.stage NOT IN('Concluído','Cancelado'))",
      );
      run(
        "UPDATE demands SET confirmed=0,data_version=data_version+1,stage='Em elaboração' WHERE stage NOT IN('Concluído','Cancelado')",
      );
      audit(
        null,
        req.user.id,
        "Política jurídica alterada; demandas abertas exigem reconfirmação e nova versão",
      );
    }
  }
  run(
    "INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    b.key,
    b.value,
  );
  audit(null, req.user.id, "Configuração atualizada: " + b.key);
  res.json({ ok: true });
});
app.post("/api/users", (req: any, res) => {
  permit(req.user, "settings");
  const b = z
    .object({
      name: z.string().min(3),
      email: z.email(),
      role: z.enum([
        "Administrador",
        "Solicitante",
        "Operação",
        "Jurídico",
        "Aprovador",
        "Consulta",
        "Risco",
        "Financeiro",
      ]),
      password: z.string().min(12),
    })
    .parse(req.body);
  run(
    "INSERT INTO users VALUES(?,?,?,?,?)",
    id(),
    b.name,
    b.email,
    b.role,
    hash(b.password),
  );
  audit(null, req.user.id, "Usuário cadastrado");
  res.json({ ok: true });
});
app.put("/api/users/:id/role", (req: any, res) => {
  permit(req.user, "settings");
  const role = z
    .enum([
      "Administrador",
      "Solicitante",
      "Operação",
      "Jurídico",
      "Aprovador",
      "Consulta",
      "Risco",
      "Financeiro",
    ])
    .parse(req.body.role);
  const u = one("SELECT * FROM users WHERE id=?", req.params.id);
  if (!u) throw Error("Usuário não encontrado.");
  if (u.id === req.user.id)
    throw Error("Peça a outro administrador para alterar seu perfil.");
  if (
    u.role === "Administrador" &&
    role !== "Administrador" &&
    one("SELECT COUNT(*) n FROM users WHERE role=?", "Administrador").n <= 1
  )
    throw Error("É necessário manter um administrador.");
  run("UPDATE users SET role=? WHERE id=?", role, u.id);
  run("DELETE FROM sessions WHERE user_id=?", u.id);
  audit(null, req.user.id, "Perfil de usuário atualizado; sessões revogadas");
  res.json({ ok: true });
});
let syncing = false;
app.post("/api/sync", async (req: any, res) => {
  permit(req.user, "sync");
  if (syncing) throw Error("Já existe uma sincronização em andamento.");
  syncing = true;
  let imported = 0;
  const tickets: GlpiTicket[] = [];
  try {
    const adapter =
      process.env.GLPI_MODE === "real"
        ? new UnconfiguredGlpiAdapter()
        : new DemoGlpiAdapter();
    await importPages(adapter, (page) => tickets.push(...page));
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const ticket of tickets) {
        if (one("SELECT id FROM demands WHERE glpi_id=?", ticket.externalId))
          continue;
        const school = one("SELECT * FROM schools WHERE id=?", ticket.schoolId);
        run(
          "INSERT INTO demands(id,glpi_id,school_id,type,stage,priority,owner,due,data,created) VALUES(?,?,?,?,?,?,?,?,?,?)",
          "KD-" + id().slice(0, 8),
          ticket.externalId,
          school.id,
          ticket.type,
          "Recebido",
          ticket.priority,
          "u2",
          new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
          JSON.stringify({
            cnpj: school.cnpj,
            razaoSocial: school.legal_name,
            checklist: false,
          }),
          now(),
        );
        imported++;
      }
      run(
        "INSERT INTO sync_logs VALUES(?,?,?,?,?)",
        id(),
        "Concluído",
        imported,
        "Demonstração: 2 páginas. Registros existentes preservados.",
        now(),
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    audit(null, req.user.id, "Importação GLPI demonstrativa");
    res.json({ imported });
  } catch (e) {
    run(
      "INSERT INTO sync_logs VALUES(?,?,?,?,?)",
      id(),
      "Falha",
      0,
      "Falha na importação. Verifique o modo e a configuração no servidor.",
      now(),
    );
    throw e;
  } finally {
    syncing = false;
  }
});
export function csvCell(v: unknown) {
  let s = String(v ?? "");
  if (/^[\s]*[=+@\-\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
function reportRows(req: any) {
  const from = req.query.from
      ? z.iso.date().parse(req.query.from)
      : "2000-01-01",
    to = req.query.to ? z.iso.date().parse(req.query.to) : "2100-12-31";
  if (from > to) throw Error("O início do período deve ser anterior ao fim.");
  return all(
    "SELECT d.id,d.created,d.completed,d.due,d.owner,d.stage,d.type,s.name AS school,u.name AS owner_name FROM demands d JOIN schools s ON s.id=d.school_id JOIN users u ON u.id=d.owner",
  ).filter(
    (d) =>
      localDate(d.created) >= from &&
      localDate(d.created) <= to &&
      (!req.query.owner || d.owner === req.query.owner) &&
      (req.user.role !== "Solicitante" || d.owner === req.user.id),
  );
}
app.get("/api/reports", (req: any, res) => {
  const rows = reportRows(req),
    completed = rows.filter((d) => d.completed),
    divergences: any[] = [];
  for (const d of rows) {
    const doc = latest(d.id);
    if (!doc) continue;
    const r = one(
      "SELECT * FROM reviews WHERE document_id=? ORDER BY created DESC LIMIT 1",
      doc.id,
    );
    if (r && r.status !== "conforme")
      divergences.push({
        id: d.id,
        school: d.school,
        status: r.status,
        count: JSON.parse(r.results).length,
      });
  }
  res.json({
    volume: rows.length,
    overdue: rows.filter(
      (d) =>
        !["Concluído", "Cancelado"].includes(d.stage) && d.due < localDate(),
    ).length,
    average: completed.length
      ? Math.round(
          completed.reduce(
            (s, d) =>
              s + (Date.parse(d.completed) - Date.parse(d.created)) / 86400000,
            0,
          ) / completed.length,
        )
      : 0,
    byOwner: all("SELECT id,name FROM users").map((u) => ({
      name: u.name,
      count: rows.filter((d) => d.owner === u.id).length,
    })),
    byStage: stages.map((stage) => ({
      stage,
      count: rows.filter((d) => d.stage === stage).length,
    })),
    divergences,
  });
});
app.get("/api/reports.csv", (req: any, res) => {
  permit(req.user, "export");
  const rows = reportRows(req);
  res
    .type("text/csv; charset=utf-8")
    .attachment("relatorio-kedu.csv")
    .send(
      "\uFEFF" +
        [
          ["Demanda", "Escola", "Etapa", "Tipo", "Prazo", "Responsável"],
          ...rows.map((r) => [
            r.id,
            r.school,
            r.stage,
            r.type,
            r.due,
            r.owner_name,
          ]),
        ]
          .map((r) => r.map(csvCell).join(";"))
          .join("\r\n"),
    );
});
app.use(express.static("dist"));
app.use((err: any, _req: any, res: any, _next: any) =>
  res.status(err.status || 400).json({
    error:
      err instanceof z.ZodError
        ? "Dados inválidos: " +
          err.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")
        : err.code?.startsWith("SQLITE")
          ? "Operação não permitida pelas restrições do banco."
          : err.message || "Não foi possível concluir a operação.",
  }),
);
if (process.env.NODE_ENV !== "test")
  app.listen(Number(process.env.PORT || 3001), process.env.HOST || "127.0.0.1", () =>
    console.log(`Kedu API: http://${process.env.HOST || "127.0.0.1"}:${process.env.PORT || 3001}`),
  );
export default app;
