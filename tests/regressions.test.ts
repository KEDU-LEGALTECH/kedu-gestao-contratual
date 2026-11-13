import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATABASE_PATH = join(
  mkdtempSync(join(tmpdir(), "kedu-regressions-")),
  "test.sqlite",
);
process.env.NODE_ENV = "test";
process.env.DEMO_SEED = "true";
const { default: app } = await import("../server/index.js");
const { one, all, run, db, hash, id, sql } = await import("../server/db.js");
const { demoTemplate } = await import("../server/documents.js");
const { transition, allocateAddendum } = await import("../server/workflow.js");
const { requiredFor, visibleFor, operationFields } =
  await import("../shared/request-policy.js");
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.on("listening", resolve));
after(() => {
  server.close();
});
const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
async function request(
  path: string,
  body?: unknown,
  method = body ? "POST" : "GET",
) {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}
await sql.run("INSERT INTO users VALUES(?,?,?,?,?)", "reg-admin", "Administrador real de teste", "admin@regression.local", "Administrador", hash("Regression-test-password!"));
const login = await fetch(base + "/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    email: "admin@regression.local",
    password: "Regression-test-password!",
  }),
});
const cookie = login.headers.get("set-cookie")!.split(";")[0];
const admin = await sql.one("SELECT * FROM users WHERE id='reg-admin'");
test("Modelos Canva são baixados como DOCX editável sem homologar nem modificar a versão",async()=>{
  const template=await sql.one("SELECT v.id,v.bytes FROM template_versions v JOIN template_sources s ON s.version_id=v.id LIMIT 1");
  assert.ok(template);
  const before=(await sql.one("SELECT COUNT(*) n FROM template_homologations")).n;
  const response=await fetch(base+`/templates/${template.id}/editable`,{headers:{cookie}});
  assert.equal(response.status,200);
  assert.match(response.headers.get("content-type")!,/wordprocessingml/);
  assert.match(response.headers.get("content-disposition")!,/\.docx/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),Buffer.from(template.bytes));
  assert.equal((await sql.one("SELECT COUNT(*) n FROM template_homologations")).n,before);
});
test("Visualização de modelo rascunho exige login e preserva aprovação e original",async()=>{
 const t=await sql.one("SELECT v.id,v.bytes,v.status FROM template_versions v JOIN template_sources s ON s.version_id=v.id LIMIT 1");
 const before=(await sql.one("SELECT COUNT(*) n FROM template_homologations")).n;
 const unauth=await fetch(base+`/templates/${t.id}/view`);assert.equal(unauth.status,401);
 const view=await request(`/templates/${t.id}/view`);assert.equal(view.status,200);
 assert.ok(view.data.paragraphs.length>0);assert.equal(typeof view.data.paragraphs[0],"string");
 const current=await sql.one("SELECT bytes,status FROM template_versions WHERE id=?", t.id);
 assert.equal(current.status,t.status);assert.deepEqual(Buffer.from(current.bytes),Buffer.from(t.bytes));
 assert.equal((await sql.one("SELECT COUNT(*) n FROM template_homologations")).n,before);
});

test("Cadastro de matriz externa preserva arquivo, exige declaração e permite reservar apenas o próximo aditivo", async () => {
  const d = await create();
  const bytes = Buffer.from("%PDF-1.4\nmatriz externa teste\n%%EOF");
  const send = async (attested = "true", signatureDate = "2026-01-10") => {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: "application/pdf" }), "matriz-assinada.pdf");
    for (const [key,value] of Object.entries({ signatureDate, historyDate: signatureDate, source: "Clicksign", reference: "Contrato teste histórico conferido", sequence: "0", attested })) form.append(key,value);
    const response = await fetch(base + `/demands/${d.id}/matrices`, { method: "POST", headers: { cookie }, body: form });
    return { status: response.status, data: await response.json() };
  };
  const count = (await sql.one("SELECT COUNT(*) n FROM contracts")).n;
  assert.notEqual((await send("false")).status, 200);
  assert.notEqual((await send("true", "2099-01-01")).status, 200);
  assert.equal((await sql.one("SELECT COUNT(*) n FROM contracts")).n, count);
  const registered = await send();
  assert.equal(registered.status, 200, JSON.stringify(registered.data));
  const cid = registered.data.id;
  assert.equal((await sql.one("SELECT status FROM contracts WHERE id=?", cid)).status, "Assinado");
  assert.equal((await sql.one("SELECT sequence FROM signed_history WHERE matrix_id=?", cid)).sequence, 0);
  assert.equal((await sql.one("SELECT COUNT(*) n FROM contracts WHERE parent_id=?", cid)).n, 0);
  assert.notEqual((await send()).status, 200);
  const data = JSON.parse(d.data); data.matriz = cid;
  await sql.run("UPDATE demands SET data=? WHERE id=?", JSON.stringify(data), d.id);
  const downloaded = await fetch(base + `/demands/${d.id}/matrix/${cid}/download`, { headers: { cookie } });
  assert.equal(downloaded.status, 200);
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes);
  assert.equal((await request(`/demands/${d.id}`)).data.documentBundle.externalMatrix.contract_id, cid);
  assert.equal((await allocateAddendum(d.school_id, cid)).sequence, 1);
  await assert.rejects(async () => sql.run("UPDATE external_contract_files SET name='alterado' WHERE contract_id=?", cid), /imutável/);
});
test("Documentos da demanda mostram apenas a matriz e seus aditivos e respeitam acesso restrito", async () => {
  const matrix = await create();
  await signedFixture(matrix);
  const unrelated = await create();
  await signedFixture(unrelated);
  const child = await create();
  await sql.run("UPDATE contracts SET parent_id=?,sequence=1 WHERE id=?", matrix.contract_id, child.contract_id);
  await signedFixture(child);
  const result = await request(`/demands/${child.id}`);
  assert.equal(result.status, 200);
  assert.equal(result.data.documentBundle.matrixId, matrix.contract_id);
  assert.deepEqual(new Set(result.data.documentBundle.signed.map((d: any) => d.demand_id)), new Set([matrix.id, child.id]));
  assert.equal(result.data.documentBundle.signed.some((d: any) => d.demand_id === unrelated.id), false);
  const uid = id(), token = id();
  await sql.run("INSERT INTO users VALUES(?,?,?,?,?)", uid, "Consulta teste", uid + "@test.local", "Consulta", hash("Test-password-restricted"));
  await sql.run("INSERT INTO sessions VALUES(?,?,?)", token, uid, Date.now() + 60000);
  const restricted = await fetch(base + `/demands/${child.id}`, { headers: { cookie: "session=" + token } });
  assert.equal(restricted.status, 200);
  assert.equal((await restricted.json()).documentBundle, null);
});
async function create(type = "Contrato de garantia", matrix?: string) {
  const result = await request("/demands", {
    type,
    school_id: "s4",
    owner: "reg-admin",
    priority: "Normal",
    due: "2030-01-01",
    matrix,
  });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return await sql.one("SELECT * FROM demands WHERE id=?", result.data.id);
}
async function signedFixture(d: any) {
  const doc = id();
  await sql.run("INSERT INTO documents VALUES(?,?,?,?,?,?,?,?,?,?)", doc, d.id, 1, "tv1", d.data_version, "{}", demoTemplate(), Buffer.from("%PDF-signed-fixture"), admin.id, new Date().toISOString());
  await sql.run("UPDATE demands SET stage='Em assinatura' WHERE id=?", d.id);
  return await sql.one("SELECT * FROM demands WHERE id=?", d.id);
}
async function upload(
  path: string,
  bytes: Uint8Array,
  fields: Record<string, string> = {},
  name = "minuta.docx",
) {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)]), name);
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  const res = await fetch(base + path, {
    method: "POST",
    headers: { cookie },
    body: form,
  });
  return { status: res.status, data: await res.json() };
}

test("Operações jurídicas concluídas e legadas nunca são matrizes elegíveis", async () => {
  for (const type of [
    "Distrato",
    "Descredenciamento",
    "CNPJ solidário",
    "Antecipação K-invest",
    "Parcelamento",
    "Renovação com pendências",
    "Alteração societária",
  ]) {
    const matrix = id();
    await sql.run("INSERT INTO contracts(id,school_id,status) VALUES(?,'s4','Assinado')", matrix);
    const d = await create(type, matrix);
    await transition(admin, await signedFixture(d), "Concluído");
    const c = await sql.one("SELECT * FROM contract_registry WHERE id=?", d.contract_id);
    assert.equal(c.instrument_kind, "Operação jurídica");
    assert.equal(c.source_matrix, matrix);
    assert.equal(c.status, "Concluído");
    assert.equal(
      (await sql.one("SELECT status FROM contracts WHERE id=?", matrix)).status,
      type === "Distrato"
        ? "Distratado"
        : type === "Descredenciamento"
          ? "Descredenciado"
          : "Assinado",
    );
    // Simulate the old application's already-signed operation, then rerun the migration.
    await sql.run("UPDATE contracts SET status='Assinado' WHERE id=?", d.contract_id);
    if (sql.dialect === "sqlite") db.exec(readFileSync("migrations/007.sql", "utf8"));
    assert.equal(
      (await sql.one("SELECT instrument_kind FROM contract_registry WHERE id=?", d.contract_id)).instrument_kind,
      "Operação jurídica",
    );
    await assert.rejects(
      async () => allocateAddendum("s4", d.contract_id),
      /matriz assinado/,
    );
    const bad = await request("/demands", {
      type: "Distrato",
      school_id: "s4",
      owner: admin.id,
      priority: "Normal",
      due: "2030-01-01",
      matrix: d.contract_id,
    });
    assert.equal(bad.status, 400);
    assert.equal(
      (
        await request(`/contracts/${d.contract_id}/signed-history`, {
          sequence: 0,
          source: "Clint",
          reference: "teste legado",
          signatureDate: "2026-01-01",
          attested: true,
        })
      ).status,
      400,
    );
  }
  const normal = await create();
  await transition(admin, await signedFixture(normal), "Concluído");
  assert.equal(
    (await sql.one("SELECT status FROM contracts WHERE id=?", normal.contract_id)).status,
    "Assinado",
  );
  assert.equal(
    (await sql.one("SELECT instrument_kind FROM contract_registry WHERE id=?", normal.contract_id)).instrument_kind,
    "Matriz",
  );
});

test("Upload e avanço de modelo demonstrativo são bloqueados em produção com usuário real", async () => {
  const d = await create();
  await sql.run("UPDATE demands SET glpi_id=?,stage='Em elaboração' WHERE id=?", d.id, d.id);
  process.env.NODE_ENV = "production";
  try {
    const result = await upload(`/demands/${d.id}/upload`, demoTemplate(), {
      template_version: "tv1",
    });
    assert.equal(result.status, 400);
    assert.match(result.data.error, /demonstrativos.*produção/);
    assert.equal(
      (await sql.one("SELECT COUNT(*) n FROM documents WHERE demand_id=?", d.id)).n,
      0,
    );
    const pending = await signedFixture(d);
    await assert.rejects(
      async () => transition(admin, pending, "Concluído"),
      /demonstrativos.*produção/,
    );
    assert.equal(
      (await sql.one("SELECT stage FROM demands WHERE id=?", d.id)).stage,
      "Em assinatura",
    );
  } finally {
    process.env.NODE_ENV = "test";
  }
});

test("Migração preserva a nova matriz, encerra a antiga e reverte a transação se houver pendências", async () => {
  const matrix = id();
  await sql.run("INSERT INTO contracts(id,school_id,status) VALUES(?,'s4','Assinado')", matrix);
  const migration = await create("Migração de modalidade", matrix);
  const pending = await signedFixture(migration);
  await assert.rejects(async () => transition(admin, pending, "Concluído"), /requisitos/);
  assert.equal(
    (await sql.one("SELECT status FROM contracts WHERE id=?", migration.contract_id))
      .status,
    "Em preparação",
  );
  assert.equal(
    (await sql.one("SELECT stage FROM demands WHERE id=?", migration.id)).stage,
    "Em assinatura",
  );
  const distrato = await create("Distrato", matrix);
  await transition(admin, await signedFixture(distrato), "Concluído");
  const novo = await create();
  await transition(admin, await signedFixture(novo), "Concluído");
  const { saveDetails, requirements } = await import("../server/governance.js");
  const data = {
    ...JSON.parse(migration.data),
    representanteNome: "Representante de teste",
    motivo: "Migração solicitada",
    dataFormalizacao: "2026-10-20",
    dataAssinaturaMatriz: "2026-01-01",
    localidade: "Fortaleza, CE",
    modalidade: "Garantia Completa",
    demandaDistrato: distrato.id,
    demandaNovoContrato: novo.id,
    checklist: true,
  };
  await sql.run("UPDATE demands SET data=?,confirmed=1,glpi_id=? WHERE id=?", JSON.stringify(data), migration.id, migration.id);
  await saveDetails(migration.id, {
    reportDate: "2030-01-04",
    signingMode: "Administrador nomeado",
    partnerCount: 1,
    signers: [
      {
        name: data.representanteNome,
        email: "teste@example.com",
        capacity: "Administrador",
      },
    ],
    legalFlags: [],
  });
  const current = await sql.one("SELECT * FROM demands WHERE id=?", migration.id);
  for (const kind of (await requirements(current)).evidence)
    await sql.run("INSERT INTO evidence_files VALUES(?,?,?,?,?,?,?,?,?,?)", id(), current.id, kind, "evidencia.pdf", "application/pdf", Buffer.from("%PDF-fixture"), admin.id, new Date().toISOString(), admin.id, new Date().toISOString());
  await transition(admin, current, "Concluído");
  assert.equal(
    (await sql.one("SELECT status FROM contracts WHERE id=?", matrix)).status,
    "Migrado",
  );
  assert.equal(
    (await sql.one("SELECT status FROM contracts WHERE id=?", novo.contract_id)).status,
    "Assinado",
  );
  assert.equal(
    (await sql.one("SELECT instrument_kind FROM contract_registry WHERE id=?", migration.contract_id)).instrument_kind,
    "Operação jurídica",
  );
  assert.equal(
    (await sql.one("SELECT status FROM contracts WHERE id=?", migration.contract_id))
      .status,
    "Concluído",
  );
});

test("Conferência de demanda cancelada ou concluída não altera etapa, revisões ou auditoria", async () => {
  for (const stage of ["Cancelado", "Concluído"]) {
    const d = await create();
    await signedFixture(d);
    await sql.run("UPDATE demands SET stage=? WHERE id=?", stage, d.id);
    const before = (await sql.one("SELECT COUNT(*) n FROM audit WHERE demand_id=?", d.id)).n;
    const result = await request(`/demands/${d.id}/review`, {});
    assert.equal(result.status, 400);
    assert.match(result.data.error, /encerrada/);
    assert.equal(
      (await sql.one("SELECT stage FROM demands WHERE id=?", d.id)).stage,
      stage,
    );
    assert.equal(
      (await sql.one("SELECT COUNT(*) n FROM reviews r JOIN documents doc ON doc.id=r.document_id WHERE doc.demand_id=?", d.id)).n,
      0,
    );
    assert.equal(
      (await sql.one("SELECT COUNT(*) n FROM audit WHERE demand_id=?", d.id)).n,
      before,
    );
  }
});

test("Governança rejeita versão obsoleta ou ausente e preserva origem e signatários salvos", async () => {
  const d = await create();
  await sql.run("UPDATE case_details SET payload=json_set(payload,'$.origins',json(?)) WHERE demand_id=?", JSON.stringify({ motivo: "GLPI" }), d.id);
  const g = (await request(`/demands/${d.id}/governance`)).data;
  const body = {
    expected_version: g.data_version,
    subtype: "",
    reportDate: "2030-01-04",
    signingMode: "Administrador nomeado",
    partnerCount: 1,
    signers: [
      {
        name: "Primeiro signatário",
        email: "primeiro@example.com",
        capacity: "Administrador",
      },
    ],
    legalFlags: [],
  };
  assert.equal(
    (await request(`/demands/${d.id}/governance`, body, "PUT")).status,
    200,
  );
  const saved = (await sql.one("SELECT payload FROM case_details WHERE demand_id=?", d.id)).payload;
  assert.equal(
    (
      await request(
        `/demands/${d.id}/governance`,
        { ...body, signers: [{ ...body.signers[0], name: "Edição obsoleta" }] },
        "PUT",
      )
    ).status,
    409,
  );
  const { expected_version, ...noVersion } = body;
  assert.equal(
    (await request(`/demands/${d.id}/governance`, noVersion, "PUT")).status,
    409,
  );
  assert.equal(
    (await sql.one("SELECT payload FROM case_details WHERE demand_id=?", d.id)).payload,
    saved,
  );
  assert.deepEqual(JSON.parse(saved).origins, { motivo: "GLPI" });
  assert.equal(
    (await sql.one("SELECT data_version FROM demands WHERE id=?", d.id)).data_version,
    expected_version + 1,
  );
});

test("Cada operação recebe apenas seus campos específicos, mantendo garantia e aditivos", () => {
  for (const type of Object.keys(operationFields)) {
    const fields = requiredFor(type);
    assert.ok(fields.includes("cnpj") && fields.includes("dataFormalizacao"));
    for (const unrelated of [
      "banco",
      "agencia",
      "conta",
      "garantia",
      "repasse",
      "remuneracao",
    ])
      assert.ok(!fields.includes(unrelated), `${type}: ${unrelated}`);
    assert.deepEqual(visibleFor(type), fields);
  }
  assert.ok(requiredFor("Parcelamento").includes("parcelas"));
  assert.ok(requiredFor("Antecipação K-invest").includes("valor"));
  assert.ok(requiredFor("Migração de modalidade").includes("demandaDistrato"));
  assert.ok(!requiredFor("Distrato").includes("modalidade"));
  assert.ok(requiredFor("Contrato de garantia").includes("banco"));
  assert.ok(requiredFor("Aditivo", "Conta bancária").includes("banco"));
  assert.ok(!requiredFor("Aditivo", "Vigência").includes("banco"));
});

test("Assinado aceita até 8 MB no middleware e recusa acima; minuta continua limitada a 5 MB", async () => {
  const d = await create();
  const bytes = new Uint8Array(8 * 1024 * 1024);
  bytes.set(new TextEncoder().encode("%PDF-"));
  const acceptedByMiddleware = await upload(
    `/demands/${d.id}/signature`,
    bytes,
    { attested: "true" },
    "assinado.pdf",
  );
  // This incomplete demand must reach the workflow guard, not Multer's file-size rejection.
  assert.match(acceptedByMiddleware.data.error, /Envie para assinatura/);
  const tooBig = await upload(
    `/demands/${d.id}/signature`,
    new Uint8Array(bytes.length + 1),
    {},
    "assinado.pdf",
  );
  assert.match(tooBig.data.error, /File too large/);
  const draft = await upload(
    `/demands/${d.id}/upload`,
    new Uint8Array(5 * 1024 * 1024 + 1),
  );
  assert.match(draft.data.error, /File too large/);
  assert.equal(
    (await sql.all("SELECT * FROM signature_records WHERE document_id IN (SELECT id FROM documents WHERE demand_id=?)", d.id)).length,
    0,
  );
});

test("PDF assinado de 8 MB é armazenado integralmente após todos os controles do fluxo", async () => {
  const d = await sql.one("SELECT * FROM demands WHERE id='KD-0006'");
  const { required } = await import("../server/workflow.js");
  const { humanAxes, requirements } = await import("../server/governance.js");
  // Complete the demo fixture's official inputs; signature remains a human declaration.
  const data = {
    ...JSON.parse(d.data),
    nomeFantasia: "Escola teste",
    rua: "Rua teste",
    numero: "10",
    bairro: "Centro",
    cidade: "Fortaleza",
    estado: "CE",
    cep: "60000-000",
    representanteNome: "Administrador Fictício",
    representanteCpf: "000.000.000-00",
    duracaoMeses: "24",
    parcelas: "2",
    diaRepasse: "10",
    repasseSegundo: "10,00%",
    diaSegundoRepasse: "20",
    alunos: "100",
    titularConta: "Escola teste",
    documentoTitular: JSON.parse(d.data).cnpj,
  };
  await sql.run("UPDATE demands SET data=? WHERE id=?", JSON.stringify(data), d.id);
  const current = await sql.one("SELECT * FROM demands WHERE id=?", d.id);
  assert.deepEqual(await required(current), []);
  assert.equal(
    (await sql.all("SELECT * FROM human_checks WHERE document_id='doc5'")).length,
    humanAxes.length,
  );
  for (const kind of (await requirements(current)).approvals)
    assert.ok(
      await sql.one("SELECT id FROM approvals WHERE document_id='doc5' AND kind=? AND valid=1", kind),
    );
  const bytes = new Uint8Array(8 * 1024 * 1024);
  bytes.set(
    new TextEncoder().encode("%PDF-1.4\n% arquivo fictício de teste\n"),
  );
  const result = await upload(
    `/demands/${d.id}/signature`,
    bytes,
    { attested: "true" },
    "assinado-8mb.pdf",
  );
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(
    (await sql.one("SELECT length(signed) n FROM documents WHERE id='doc5'")).n,
    bytes.length,
  );
  const downloaded = await fetch(base + "/documents/doc5/download?signed=1", {
    headers: { cookie },
  });
  assert.equal(downloaded.status, 200);
  assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()), bytes);
});
