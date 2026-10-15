import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PizZip from "pizzip";
process.env.DATABASE_PATH = join(
  mkdtempSync(join(tmpdir(), "kedu-test-")),
  "test.sqlite",
);
process.env.NODE_ENV = "test";
const { default: app, csvCell } = await import("../server/index.js");
const { all, one, run, db } = await import("../server/db.js");
const { generate, review, demoTemplate, fixed } =
  await import("../server/documents.js");
const { allocateAddendum } = await import("../server/workflow.js");
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.on("listening", resolve));
const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
async function request(path: string, body?: any, cookie = "", method?: string) {
  const res = await fetch(base + path, {
    method: method || (body ? "POST" : "GET"),
    headers: { "Content-Type": "application/json", cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: res.status,
    data: await res.json(),
    cookie: res.headers.get("set-cookie")?.split(";")[0] || "",
  };
}
const admin = (
  await request("/login", {
    email: "admin@demo.kedu.local",
    password: "Kedu-demo-2026!",
  })
).cookie;
const snapshot = JSON.parse(
  one("SELECT data FROM demands WHERE id=?", "KD-0001").data,
);
const { humanAxes, requirements, governanceMissing } =
  await import("../server/governance.js");
async function prepareGovernance(
  did: string,
  subtype = "",
  flags: string[] = [],
) {
  let r = await request(
    "/demands/" + did + "/glpi-reference",
    { number: did, attested: true },
    admin,
  );
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await request(
    "/demands/" + did + "/governance",
    {
      subtype,
      reportDate: "2030-01-04",
      signingMode: "Administrador nomeado",
      partnerCount: 1,
      signers: [
        {
          name: "Administrador de teste",
          email: "teste@example.com",
          capacity: "Administrador",
        },
      ],
      legalFlags: flags,
    },
    admin,
    "PUT",
  );
  assert.equal(r.status, 200, JSON.stringify(r.data));
  for (const kind of requirements(one("SELECT * FROM demands WHERE id=?", did))
    .evidence) {
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(demoTemplate())]),
      "evidencia-demonstrativa.docx",
    );
    form.append("kind", kind);
    const res = await fetch(base + "/demands/" + did + "/evidence", {
      method: "POST",
      headers: { cookie: admin },
      body: form,
    });
    assert.equal(res.status, 200, await res.text());
    const evidence = one(
      "SELECT id FROM evidence_files WHERE demand_id=? AND kind=? ORDER BY created DESC LIMIT 1",
      did,
      kind,
    );
    assert.equal(
      (
        await request(
          "/demands/" + did + "/evidence/" + evidence.id + "/verify",
          { attested: true },
          admin,
        )
      ).status,
      200,
    );
  }
}
async function humanReview(did: string) {
  for (const axis of humanAxes) {
    const r = await request(
      "/demands/" + did + "/human-check",
      {
        axis,
        result: "Aprovado",
        notes: "Conferência humana de teste com evidência fictícia.",
      },
      admin,
    );
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
}
test("Valores monetários e percentuais persistem em unidades inteiras distintas", () => {
  const terms = one(
    "SELECT * FROM commercial_terms WHERE demand_id=?",
    "KD-0001",
  );
  assert.equal(terms.remuneration_bps, 770);
  assert.equal(terms.guarantee_bps, 10000);
  assert.equal(terms.transfer_bps, 9230);
  assert.equal(terms.reference_cents, 1000000);
});
test("Percentuais fora de faixa e alteração de matriz são rejeitados", async () => {
  assert.equal(
    (
      await request(
        "/demands/KD-0001/data",
        { garantia: "100,01%" },
        admin,
        "PUT",
      )
    ).status,
    400,
  );
  assert.equal(
    (await request("/demands/KD-0001/data", { matriz: "c4" }, admin, "PUT"))
      .status,
    400,
  );
});
test("Relatório respeita período e identifica conferência divergente", async () => {
  const r = await request(
    "/reports?from=2000-01-01&to=2100-01-01",
    undefined,
    admin,
  );
  assert.equal(r.status, 200);
  assert.ok(r.data.divergences.some((d: any) => d.id === "KD-0003"));
  const empty = await request(
    "/reports?from=2000-01-01&to=2000-01-02",
    undefined,
    admin,
  );
  assert.equal(empty.data.volume, 0);
  assert.equal(
    (await request("/reports?from=2026-12-01&to=2026-01-01", undefined, admin))
      .status,
    400,
  );
});
test("7,70% versus 7,80% é uma divergência crítica", () => {
  const r = review(
    generate(demoTemplate(), { ...snapshot, remuneracao: "7,80%" }),
    snapshot,
    demoTemplate(),
  );
  assert.equal(r.status, "divergente");
  assert.ok(
    r.results.some(
      (x) =>
        x.field === "remuneracao" &&
        x.expected === "7,70%" &&
        x.found === "7,80%",
    ),
  );
});
test("CNPJ e conta bancária divergentes são detectados", () => {
  const r = review(
    generate(demoTemplate(), {
      ...snapshot,
      cnpj: "99.999.999/0001-99",
      conta: "00000-0",
    }),
    snapshot,
    demoTemplate(),
  );
  assert.ok(r.results.some((x) => x.field === "cnpj"));
  assert.ok(r.results.some((x) => x.field === "conta"));
});
test("Obrigatório ausente impede aprovação e confirmação", async () => {
  const r = await request(
    "/demands/KD-0002/stage",
    { stage: "Em aprovação" },
    admin,
  );
  assert.equal(r.status, 400);
  assert.equal(
    (await request("/demands/KD-0002/confirm", {}, admin)).status,
    400,
  );
});
test("Alteração no corpo fixo exige revisão jurídica", () => {
  const zip = new PizZip(generate(demoTemplate(), snapshot));
  zip.file(
    "word/document.xml",
    zip.file("word/document.xml")!.asText().replace(fixed, "Cláusula alterada"),
  );
  const r = review(
    zip.generate({ type: "nodebuffer" }),
    snapshot,
    demoTemplate(),
  );
  assert.ok(
    r.results.some(
      (x) => x.field === "Corpo fixo" && x.guidance.includes("jurídica"),
    ),
  );
});
test("Arquivo inseguro resulta em conferência inconclusiva", () =>
  assert.equal(
    review(Buffer.from("not-docx"), snapshot, demoTemplate()).status,
    "inconclusiva",
  ));
test("Mudança após aprovação invalida aprovações e confirmação", async () => {
  assert.ok(
    one(
      "SELECT COUNT(*) n FROM approvals WHERE document_id=? AND valid=1",
      "doc5",
    ).n > 0,
  );
  const r = await request(
    "/demands/KD-0006/data",
    { remuneracao: "7,80%" },
    admin,
    "PUT",
  );
  assert.equal(r.status, 400);
  run("UPDATE demands SET stage=? WHERE id=?", "Em aprovação", "KD-0006");
  assert.equal(
    (
      await request(
        "/demands/KD-0006/data",
        { remuneracao: "7,80%" },
        admin,
        "PUT",
      )
    ).status,
    200,
  );
  assert.equal(
    one(
      "SELECT COUNT(*) n FROM approvals WHERE document_id=? AND valid=1",
      "doc5",
    ).n,
    0,
  );
  assert.equal(
    one("SELECT confirmed FROM demands WHERE id=?", "KD-0006").confirmed,
    0,
  );
});
test("Sincronização repetida não duplica ou sobrescreve demandas", async () => {
  const a = await request("/sync", {}, admin);
  assert.equal(a.data.imported, 4);
  const b = await request("/sync", {}, admin);
  assert.equal(b.data.imported, 0);
  assert.equal(
    all("SELECT * FROM demands WHERE glpi_id LIKE 'DEMO-%'").length,
    4,
  );
});
test("Consulta não aprova, não baixa e não vê dados bancários", async () => {
  const c = (
    await request("/login", {
      email: "consulta@demo.kedu.local",
      password: "Kedu-demo-2026!",
    })
  ).cookie;
  assert.equal(
    (await request("/demands/KD-0004/approve", { kind: "Comercial" }, c))
      .status,
    403,
  );
  assert.equal(
    (await request("/documents/doc3/download", undefined, c)).status,
    403,
  );
  const d = await request("/demands/KD-0003", undefined, c);
  assert.equal(d.data.data.conta, undefined);
  assert.ok(
    d.data.reviews.every((r: any) =>
      r.results
        .filter((x: any) => x.field === "conta")
        .every((x: any) => x.expected === "Restrito"),
    ),
  );
});
test("Reservas concorrentes não recebem o mesmo número de aditivo", async () => {
  assert.equal(
    (
      await request(
        "/demands",
        {
          school_id: "s4",
          type: "Aditivo",
          owner: "u2",
          priority: "Normal",
          due: "2026-12-01",
          matrix: "c4",
        },
        admin,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/contracts/c4/signed-history",
        {
          sequence: 3,
          source: "Clicksign",
          reference: "Registro fictício 003",
          signatureDate: "2026-01-01",
          attested: true,
        },
        admin,
      )
    ).status,
    200,
  );
  const result = await Promise.all(
    Array.from({ length: 12 }, () =>
      request(
        "/demands",
        {
          school_id: "s4",
          type: "Aditivo",
          owner: "u2",
          priority: "Normal",
          due: "2026-12-01",
          matrix: "c4",
        },
        admin,
      ),
    ),
  );
  assert.equal(result.filter((r) => r.status === 200).length, 1);
  assert.equal(result.filter((r) => r.status === 400).length, 11);
  const seq = all("SELECT sequence FROM contracts WHERE parent_id=?", "c4").map(
    (c) => c.sequence,
  );
  assert.equal(seq.length, 1);
  assert.equal(new Set(seq).size, 1);
  assert.equal(seq[0], 4);
  assert.throws(() => allocateAddendum("s0", "c4"));
});
test("Modelo aprovado é imutável no banco", () =>
  assert.throws(() =>
    run("UPDATE template_versions SET body=? WHERE id=?", "changed", "tv1"),
  ));
test("CSV neutraliza fórmulas, tabulação e escapes", () => {
  assert.equal(csvCell("=1+1"), '"\'=1+1"');
  assert.equal(csvCell("  @SUM(A1)"), '"\'  @SUM(A1)"');
  assert.equal(csvCell('a"b'), '"a""b"');
});
test("Fluxo completo: criação, confirmação, geração, conferência, aprovação, assinatura e conclusão", async () => {
  const newD = await request(
    "/demands",
    {
      school_id: "s0",
      type: "Contrato de garantia",
      owner: "u2",
      priority: "Normal",
      due: "2026-12-01",
    },
    admin,
  );
  const did = newD.data.id;
  await prepareGovernance(did);
  assert.equal(
    (
      await request(
        "/demands/" + did + "/data",
        {
          ...snapshot,
          matriz: one("SELECT contract_id FROM demands WHERE id=?", did)
            .contract_id,
        },
        admin,
        "PUT",
      )
    ).status,
    200,
  );
  assert.equal(
    (await request("/demands/" + did + "/confirm", {}, admin)).status,
    200,
  );
  assert.equal(
    (await request("/demands/" + did + "/generate", {}, admin)).status,
    200,
  );
  assert.equal(
    (await request("/demands/" + did + "/review", {}, admin)).data.status,
    "conforme",
  );
  assert.equal(
    (
      await request(
        "/demands/" + did + "/stage",
        { stage: "Em aprovação" },
        admin,
      )
    ).status,
    200,
  );
  await humanReview(did);
  for (const kind of ["Risco", "Jurídica"])
    assert.equal(
      (await request("/demands/" + did + "/approve", { kind }, admin)).status,
      200,
    );
  assert.equal(
    (
      await request(
        "/demands/" + did + "/stage",
        { stage: "Em assinatura" },
        admin,
      )
    ).status,
    200,
  );
  assert.equal(
    (await request("/demands/" + did + "/stage", { stage: "Concluído" }, admin))
      .status,
    400,
  );
  const form = new FormData();
  form.append("attested", "true");
  form.append(
    "file",
    new Blob([new Uint8Array(generate(demoTemplate(), snapshot))]),
    "assinado.docx",
  );
  const r = await fetch(base + "/demands/" + did + "/signature", {
    method: "POST",
    headers: { cookie: admin },
    body: form,
  });
  assert.equal(r.status, 200);
  assert.equal(
    (await request("/demands/" + did + "/stage", { stage: "Concluído" }, admin))
      .status,
    200,
  );
  assert.equal(
    one("SELECT stage FROM demands WHERE id=?", did).stage,
    "Concluído",
  );
});
test("Autonomia dos cinco aditivos e exigência Financeiro na conta bancária", () => {
  for (const subtype of [
    "Conta bancária",
    "Vigência",
    "Percentual/data de repasse",
    "Cashback",
    "Taxa de remuneração",
  ]) {
    const did = "policy-" + subtype;
    run(
      "INSERT INTO demands(id,school_id,type,stage,priority,owner,due,data,created) VALUES(?,?,?,?,?,?,?,?,?)",
      did,
      "s0",
      "Aditivo",
      "Recebido",
      "Normal",
      "u2",
      "2030-01-01",
      "{}",
      new Date().toISOString(),
    );
    run(
      "INSERT INTO case_details VALUES(?,?)",
      did,
      JSON.stringify({ subtype, legalFlags: [] }),
    );
    assert.deepEqual(
      requirements(one("SELECT * FROM demands WHERE id=?", did)).approvals,
      subtype === "Conta bancária" ? ["Risco", "Financeiro"] : ["Risco"],
    );
  }
});
test("K-invest, parcelamento e migração exigem os documentos próprios", () => {
  assert.ok(
    requirements({
      id: "none",
      type: "Antecipação K-invest",
    }).evidence.includes("confissao_divida"),
  );
  assert.ok(
    requirements({ id: "none", type: "Parcelamento" }).evidence.includes(
      "confissao_divida",
    ),
  );
  assert.deepEqual(
    requirements({ id: "none", type: "Migração de modalidade" }).evidence,
    ["contrato_social", "matriz_assinada", "distrato", "novo_contrato"],
  );
  assert.ok(
    requirements({ id: "none", type: "CNPJ solidário" }).evidence.includes(
      "nexo_economico",
    ),
  );
});
test("Placeholder [DADO] bloqueia conferência", () => {
  const zip = new PizZip(generate(demoTemplate(), snapshot));
  zip.file(
    "word/document.xml",
    zip.file("word/document.xml")!.asText().replace("7,70%", "[DADO]"),
  );
  assert.ok(
    review(
      zip.generate({ type: "nodebuffer" }),
      snapshot,
      demoTemplate(),
    ).results.some((f) => f.field === "Placeholder"),
  );
});
test("Conferência divergente devolve automaticamente e invalida aprovações", async () => {
  const r = await request("/demands/KD-0003/review", {}, admin);
  assert.equal(r.data.status, "divergente");
  assert.equal(
    one("SELECT stage FROM demands WHERE id=?", "KD-0003").stage,
    "Devolvido",
  );
});
test("Reporte deve ser sexta-feira e poderes exigem administrador único ou todos os sócios", async () => {
  let r = await request(
    "/demands/KD-0001/governance",
    {
      subtype: "",
      reportDate: "2030-01-03",
      signingMode: "Administrador nomeado",
      partnerCount: 1,
      signers: [
        {
          name: "Teste",
          email: "teste@example.com",
          capacity: "Administrador",
        },
      ],
      legalFlags: [],
    },
    admin,
    "PUT",
  );
  assert.equal(r.status, 400);
  r = await request(
    "/demands/KD-0001/governance",
    {
      subtype: "",
      reportDate: "2030-01-04",
      signingMode: "Todos os sócios",
      partnerCount: 2,
      signers: [
        { name: "Teste", email: "teste@example.com", capacity: "Sócio" },
      ],
      legalFlags: [],
    },
    admin,
    "PUT",
  );
  assert.equal(r.status, 200);
  assert.ok(
    governanceMissing(one("SELECT * FROM demands WHERE id=?", "KD-0001")).some(
      (x) => x.includes("Todos os sócios"),
    ),
  );
});
test("Histórico assinado é imutável e não retrocede", async () => {
  assert.equal(
    (
      await request(
        "/contracts/c4/signed-history",
        {
          sequence: 2,
          source: "Clint",
          reference: "Registro fictício anterior",
          signatureDate: "2026-01-01",
          attested: true,
        },
        admin,
      )
    ).status,
    400,
  );
  assert.throws(() =>
    run("UPDATE signed_history SET sequence=10 WHERE matrix_id=?", "c4"),
  );
});
test("Jurídico obrigatório quando corpo fixo ou poderes societários mudam", async () => {
  const d = one("SELECT * FROM demands WHERE id=?", "policy-Vigência");
  run(
    "UPDATE case_details SET payload=? WHERE demand_id=?",
    JSON.stringify({
      subtype: "Vigência",
      legalFlags: ["Alteração societária"],
    }),
    d.id,
  );
  assert.deepEqual(requirements(d).approvals, ["Risco", "Jurídica"]);
});
test("Risco e Financeiro não podem aprovar um pelo outro", async () => {
  const finance = (
    await request("/login", {
      email: "financeiro@demo.kedu.local",
      password: "Kedu-demo-2026!",
    })
  ).cookie;
  assert.equal(
    (await request("/demands/KD-0004/approve", { kind: "Risco" }, finance))
      .status,
    403,
  );
  const risk = (
    await request("/login", {
      email: "risco@demo.kedu.local",
      password: "Kedu-demo-2026!",
    })
  ).cookie;
  assert.equal(
    (await request("/demands/KD-0004/approve", { kind: "Financeiro" }, risk))
      .status,
    403,
  );
});
test("Relatório jurídico exige revisão humana e mantém os cinco eixos", async () => {
  const r = await request("/demands/KD-0001/governance", undefined, admin);
  assert.equal(r.data.report.status, "REPROVADO");
  assert.equal(r.data.report.axes.length, 5);
  assert.equal(r.data.report.disclaimer.includes("não constitui"), true);
});
test("Aditivo bancário exige Risco e Financeiro, sem aprovação jurídica genérica", async () => {
  const d = one(
    "SELECT * FROM demands WHERE type='Aditivo' AND contract_id IS NOT NULL LIMIT 1",
  );
  await prepareGovernance(d.id, "Conta bancária");
  let r = await request(
    "/demands/" + d.id + "/data",
    {
      ...snapshot,
      matriz: "c4",
      aditivo: "4",
      dataAssinaturaMatriz: "2026-01-01",
    },
    admin,
    "PUT",
  );
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(
    (await request("/demands/" + d.id + "/confirm", {}, admin)).status,
    200,
  );
  assert.equal(
    (
      await request(
        "/demands/" + d.id + "/generate",
        { template_version: "tv1" },
        admin,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/demands/" + d.id + "/generate",
        { template_version: "tv-aditivo-0" },
        admin,
      )
    ).status,
    200,
  );
  assert.equal(
    (await request("/demands/" + d.id + "/review", {}, admin)).data.status,
    "conforme",
  );
  await humanReview(d.id);
  assert.equal(
    (
      await request(
        "/demands/" + d.id + "/stage",
        { stage: "Em aprovação" },
        admin,
      )
    ).status,
    200,
  );
  assert.equal(
    (await request("/demands/" + d.id + "/approve", { kind: "Risco" }, admin))
      .status,
    200,
  );
  assert.equal(
    (
      await request(
        "/demands/" + d.id + "/stage",
        { stage: "Em assinatura" },
        admin,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/demands/" + d.id + "/approve",
        { kind: "Financeiro" },
        admin,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        "/demands/" + d.id + "/stage",
        { stage: "Em assinatura" },
        admin,
      )
    ).status,
    200,
  );
});
test("Novo arquivo de evidência exige nova verificação, mesmo havendo versão antiga verificada", async () => {
  const d = one("SELECT * FROM demands WHERE id='KD-0001'");
  const before = governanceMissing(d);
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(demoTemplate())]),
    "nova-evidencia.docx",
  );
  form.append("kind", "contrato_social");
  assert.equal(
    (
      await fetch(base + "/demands/" + d.id + "/evidence", {
        method: "POST",
        headers: { cookie: admin },
        body: form,
      })
    ).status,
    200,
  );
  assert.ok(
    governanceMissing(one("SELECT * FROM demands WHERE id=?", d.id)).includes(
      "Contrato social e alterações societárias",
    ),
  );
});
test("Minuta externa pode ser conferida sem geração anterior, mas exige modelo aprovado e chamado", async () => {
  const created = await request(
    "/demands",
    {
      school_id: "s0",
      type: "Contrato de garantia",
      owner: "u2",
      priority: "Normal",
      due: "2030-01-01",
    },
    admin,
  );
  const did = created.data.id;
  const send = async () => {
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(generate(demoTemplate(), snapshot))]),
      "minuta-externa.docx",
    );
    form.append("template_version", "tv1");
    return fetch(base + "/demands/" + did + "/upload", {
      method: "POST",
      headers: { cookie: admin },
      body: form,
    });
  };
  assert.equal((await send()).status, 400);
  assert.equal(
    (
      await request(
        "/demands/" + did + "/glpi-reference",
        { number: did, attested: true },
        admin,
      )
    ).status,
    200,
  );
  assert.equal((await send()).status, 200);
  assert.equal(
    one("SELECT COUNT(*) n FROM documents WHERE demand_id=?", did).n,
    1,
  );
});
test("Catálogo mantém cinco modelos de aditivo identificados como demonstração", () => {
  const templates = all(
    "SELECT * FROM template_catalog WHERE document_type=?",
    "Aditivo",
  );
  assert.equal(templates.length, 5);
  assert.ok(templates.every((t) => t.demonstration === 1));
});
test("PDF assinado exige declaração, preserva MIME e alimenta histórico do aditivo na conclusão", async () => {
  const d = one(
    "SELECT * FROM demands WHERE type='Aditivo' AND stage='Em assinatura' LIMIT 1",
  );
  const pdf = Buffer.from(
    "%PDF-1.4\n% Documento fictício para teste de armazenamento. Não contém assinatura válida.\n%%EOF",
  );
  async function send(attested: boolean) {
    const b = new FormData();
    b.append(
      "file",
      new Blob([pdf], { type: "application/pdf" }),
      "arquivo-ficticio-assinado.pdf",
    );
    b.append("attested", String(attested));
    return fetch(base + "/demands/" + d.id + "/signature", {
      method: "POST",
      headers: { cookie: admin },
      body: b,
    });
  }
  assert.equal((await send(false)).status, 400);
  assert.equal((await send(true)).status, 200);
  assert.equal((await send(true)).status, 400);
  const doc = one(
    "SELECT id FROM documents WHERE demand_id=? ORDER BY version DESC LIMIT 1",
    d.id,
  );
  const download = await fetch(
    base + "/documents/" + doc.id + "/download?signed=1",
    { headers: { cookie: admin } },
  );
  assert.match(download.headers.get("content-type") || "", /application\/pdf/);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), pdf);
  assert.equal(
    (
      await request(
        "/demands/" + d.id + "/stage",
        { stage: "Concluído" },
        admin,
      )
    ).status,
    200,
  );
  assert.equal(
    one("SELECT MAX(sequence) n FROM signed_history WHERE matrix_id=?", "c4").n,
    4,
  );
  assert.equal(
    (await request("/demands/" + d.id + "/governance", undefined, admin)).data
      .report.status,
    "APROVADO",
  );
});
test("Atraso após quinta-feira exige justificativa e é auditado", async () => {
  const d = one("SELECT * FROM demands WHERE id=?", "KD-0004");
  const payload = JSON.parse(
    one("SELECT payload FROM case_details WHERE demand_id=?", d.id).payload,
  );
  run(
    "UPDATE case_details SET payload=? WHERE demand_id=?",
    JSON.stringify({ ...payload, reportDate: "2026-01-02" }),
    d.id,
  );
  assert.equal(
    (await request("/demands/" + d.id + "/approve", { kind: "Risco" }, admin))
      .status,
    400,
  );
  assert.equal(
    (
      await request(
        "/demands/" + d.id + "/approve",
        {
          kind: "Risco",
          delayReason: "Atraso fictício justificado para teste.",
        },
        admin,
      )
    ).status,
    200,
  );
  assert.ok(
    one(
      "SELECT id FROM audit WHERE demand_id=? AND action LIKE ?",
      d.id,
      "Validação fora do prazo%",
    ),
  );
});
test("Relatório não aprova versão antiga depois de alteração dos dados", async () => {
  const r = await request(
    "/demands/KD-0004/data",
    { remuneracao: "8,00%" },
    admin,
    "PUT",
  );
  assert.equal(r.status, 200);
  const report = (
    await request("/demands/KD-0004/governance", undefined, admin)
  ).data.report;
  assert.equal(report.status, "REPROVADO");
  assert.ok(report.missing.some((m: string) => m.includes("desatualizada")));
});
test("Ressalvas exigem ocorrências completas e críticas só permitem reprovação", async () => {
  const d = one(
    "SELECT d.* FROM demands d JOIN documents doc ON doc.demand_id=d.id WHERE d.stage='Em conferência' AND doc.data_version=d.data_version ORDER BY d.created DESC LIMIT 1",
  );
  const body = {
    axis: "Português e redação",
    result: "Aprovado com ressalvas",
    notes: "Correção de redação apontada pelo revisor de teste.",
    issues: [] as any[],
  };
  assert.equal(
    (await request("/demands/" + d.id + "/human-check", body, admin)).status,
    400,
  );
  body.issues = [
    {
      location: "Parágrafo 3",
      problem: "Erro de grafia",
      correction: "Ajustar a palavra indicada",
      severity: "crítica",
    },
  ];
  assert.equal(
    (await request("/demands/" + d.id + "/human-check", body, admin)).status,
    400,
  );
  body.issues[0].severity = "menor";
  assert.equal(
    (await request("/demands/" + d.id + "/human-check", body, admin)).status,
    200,
  );
  const g = (
    await request("/demands/" + d.id + "/governance", undefined, admin)
  ).data;
  assert.equal(
    g.report.axes.find((a: any) => a.axis === "Português e redação").check
      .issues[0].location,
    "Parágrafo 3",
  );
  body.result = "Reprovado";
  body.issues[0].severity = "crítica";
  assert.equal(
    (await request("/demands/" + d.id + "/human-check", body, admin)).status,
    200,
  );
  assert.equal(
    one("SELECT stage FROM demands WHERE id=?", d.id).stage,
    "Devolvido",
  );
});
test("Próxima emissão após conclusão exige reconferência externa do último assinado", async () => {
  const payload = {
    school_id: "s4",
    type: "Aditivo",
    owner: "u2",
    priority: "Normal",
    due: "2030-01-01",
    matrix: "c4",
  };
  assert.equal((await request("/demands", payload, admin)).status, 400);
  assert.equal(
    (
      await request(
        "/contracts/c4/signed-history",
        {
          sequence: 4,
          source: "Clint",
          reference: "Reconferência fictícia do quarto assinado",
          signatureDate: "2026-01-01",
          attested: true,
        },
        admin,
      )
    ).status,
    200,
  );
  const created = await request("/demands", payload, admin);
  assert.equal(created.status, 200);
  const c = one(
    "SELECT c.sequence FROM contracts c JOIN demands d ON d.contract_id=c.id WHERE d.id=?",
    created.data.id,
  );
  assert.equal(c.sequence, 5);
});
test("Operações jurídicas sobre contrato existente exigem matriz da mesma escola", async () => {
  const payload = {
    school_id: "s4",
    type: "Antecipação K-invest",
    owner: "u2",
    priority: "Normal",
    due: "2030-01-01",
  };
  assert.equal((await request("/demands", payload, admin)).status, 400);
  assert.equal(
    (await request("/demands", { ...payload, matrix: "c0" }, admin)).status,
    400,
  );
  assert.equal(
    (await request("/demands", { ...payload, matrix: "c4" }, admin)).status,
    200,
  );
});
test("Alteração estrutural encaminha automaticamente ao Jurídico e o formulário não remove o controle", async () => {
  const d = one(
    "SELECT d.* FROM demands d JOIN contracts c ON c.id=d.contract_id WHERE d.type='Aditivo' AND c.sequence=5 LIMIT 1",
  );
  assert.equal(
    (
      await request(
        "/demands/" + d.id + "/glpi-reference",
        { number: d.id, attested: true },
        admin,
      )
    ).status,
    200,
  );
  const payload = {
    subtype: "Vigência",
    reportDate: "2030-01-04",
    signingMode: "Administrador nomeado",
    partnerCount: 1,
    signers: [
      {
        name: "Administrador de teste",
        email: "teste@example.com",
        capacity: "Administrador",
      },
    ],
    legalFlags: [],
  };
  assert.equal(
    (await request("/demands/" + d.id + "/governance", payload, admin, "PUT"))
      .status,
    200,
  );
  const zip = new PizZip(
    generate(demoTemplate("Aditivo de Vigência"), snapshot),
  );
  zip.file(
    "word/document.xml",
    zip
      .file("word/document.xml")!
      .asText()
      .replace(fixed, "Corpo fixo alterado para cenário de teste."),
  );
  const b = new FormData();
  b.append(
    "file",
    new Blob([new Uint8Array(zip.generate({ type: "nodebuffer" }))]),
    "minuta-alterada.docx",
  );
  b.append("template_version", "tv-aditivo-1");
  assert.equal(
    (
      await fetch(base + "/demands/" + d.id + "/upload", {
        method: "POST",
        headers: { cookie: admin },
        body: b,
      })
    ).status,
    200,
  );
  assert.equal(
    (await request("/demands/" + d.id + "/review", {}, admin)).data.status,
    "divergente",
  );
  assert.deepEqual(
    requirements(one("SELECT * FROM demands WHERE id=?", d.id)).approvals,
    ["Risco", "Jurídica"],
  );
  assert.equal(
    (await request("/demands/" + d.id + "/governance", payload, admin, "PUT"))
      .status,
    200,
  );
  assert.deepEqual(
    requirements(one("SELECT * FROM demands WHERE id=?", d.id)).approvals,
    ["Risco", "Jurídica"],
  );
});
test("Renovação que menciona contratos anteriores exige Jurídico sem inventar pendência financeira", () => {
  run(
    "UPDATE case_details SET payload=? WHERE demand_id=?",
    JSON.stringify({
      subtype: "Cashback",
      legalFlags: ["Renovação com contratos anteriores"],
    }),
    "policy-Cashback",
  );
  const r = requirements(
    one("SELECT * FROM demands WHERE id=?", "policy-Cashback"),
  );
  assert.ok(r.approvals.includes("Jurídica"));
  assert.ok(r.evidence.includes("contratos_anteriores"));
  assert.ok(!r.evidence.includes("pendencias_financeiras"));
});
test("Garantia Completa não pode ser confirmada com percentual de garantia inferior a 100%", () => {
  const d = one("SELECT * FROM demands WHERE id=?", "KD-0001");
  assert.ok(
    governanceMissing({
      ...d,
      data: JSON.stringify({
        ...snapshot,
        modalidade: "Garantia Completa",
        garantia: "90,00%",
      }),
    }).includes("Garantia Completa exige garantia de 100,00%"),
  );
});
after(() => {
  server.close();
  db.close();
});
