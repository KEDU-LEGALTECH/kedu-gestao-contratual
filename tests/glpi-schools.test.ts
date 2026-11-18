import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "kedu-schools-")), "test.sqlite");
process.env.NODE_ENV = "test";
process.env.DEMO_SEED = "false";
process.env.GLPI_MODE = "demo";
const { one, run, db, sql } = await import("../server/db.js");
const { importGlpiSchools } = await import("../server/glpi-schools.js");
const { referenceDocuments, formatDocument } = await import("../server/reference-document.js");
const { syncGlpi, listTickets } = await import("../server/glpi-sync.js");
function raw(externalId: string, name: string, cnpj: string) {
  return { externalId, title: "Aditivo de vigência", content: `<p>RAZÃO SOCIAL: ${name}</p><p>CNPJ: ${cnpj}</p>`, status: "2", created: "", updated: "", category: "", groups: ["JURIDICO CONTRATOS"], followups: [], documents: [], documentsAvailable: true };
}
async function store(ticket: ReturnType<typeof raw>, mode = "real") {
  await sql.run("INSERT INTO glpi_tickets VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", ticket.externalId, mode, ticket.title, ticket.status, "hash-" + ticket.externalId, JSON.stringify(ticket), "{}", "novo", null, "2026-10-20", "2026-10-20", null);
}
async function reset() {
  for (const table of ["school_glpi_sources", "school_glpi_origins", "audit", "glpi_tickets", "schools"]) await sql.run("DELETE FROM " + table);
}

test("Importa escola com CNPJ válido uma única vez, com origem e sem inventar endereço", async () => {
  await store(raw("1", "Escola Real Teste Ltda", "11.444.777/0001-61"));
  await store(raw("2", "Escola Real Teste Ltda", "11444777000161"));
  assert.equal((await importGlpiSchools(null)).created, 1);
  const school = await sql.one("SELECT * FROM schools");
  assert.equal(school.cnpj, "11.444.777/0001-61");
  assert.equal(school.address, "");
  assert.equal(school.contact, "");
  assert.equal((await sql.one("SELECT first_ticket,reviewed_at FROM school_glpi_origins")).first_ticket, "2");
  assert.equal((await sql.one("SELECT reviewed_at FROM school_glpi_origins")).reviewed_at, null);
  assert.equal((await sql.one("SELECT COUNT(*) n FROM school_glpi_sources")).n, 2);
  assert.equal((await importGlpiSchools(null)).created, 0);
  assert.equal((await sql.one("SELECT COUNT(*) n FROM schools")).n, 1);
  assert.equal((await sql.one("SELECT COUNT(*) n FROM school_glpi_sources")).n, 2);
  assert.equal((await sql.one("SELECT COUNT(*) n FROM demands")).n, 0);
});

test("Nome divergente não substitui cadastro existente nem duplica CNPJ sem pontuação", async () => {
  await reset();
  await sql.run("INSERT INTO schools VALUES('existing','Nome fantasia','Razão conferida Ltda','11444777000161','Endereço conferido','Contato conferido')");
  await store(raw("3", "Nome diferente vindo do GLPI", "11.444.777/0001-61"));
  const before = await sql.one("SELECT * FROM schools");
  const result = await importGlpiSchools(null);
  assert.equal(result.created, 0);
  assert.equal(result.matched, 1);
  assert.equal(result.conflicts, 1);
  assert.deepEqual(await sql.one("SELECT * FROM schools"), before);
  assert.equal((await sql.one("SELECT name_conflict FROM school_glpi_sources")).name_conflict, 1);
});

test("Dados inválidos, razão social ausente e chamados demo não geram escolas", async () => {
  await reset();
  await store(raw("4", "Escola inválida", "11.444.777/0001-62"));
  await store(raw("5", "", "11.444.777/0001-61"));
  await store(raw("6", "Escola fictícia", "11.444.777/0001-61"), "demo");
  assert.equal((await importGlpiSchools(null)).skipped, 2);
  assert.equal((await sql.one("SELECT COUNT(*) n FROM schools")).n, 0);
});

test("CNPJ do formulário só é corrigido quando o dígito verificador comprova; vários CNPJs nunca são escolhidos às cegas", () => {
  const read = (value: string) => referenceDocuments(value).map(r => formatDocument(r.digits) + (r.repaired ? " corrigido" : ""));
  assert.deepEqual(read("11.444.777.000.161,00"), ["11.444.777/0001-61 corrigido"], "campo numérico do GLPI");
  assert.deepEqual(read("11.444.777.000.16100"), ["11.444.777/0001-61 corrigido"], "campo numérico sem a vírgula");
  assert.deepEqual(read("1234567000195"), ["01.234.567/0001-95 corrigido"], "zero inicial perdido");
  assert.deepEqual(read("529.982.247-25 (CPF)"), ["529.982.247-25"]);
  assert.deepEqual(read("11.444.777/0001-61 e 11.222.333/0001-81"), ["11.444.777/0001-61", "11.222.333/0001-81"]);
  assert.deepEqual(read("45.543.580/0001-00 e 11.444.777/0001-61"), ["11.444.777/0001-61"], "o CNPJ da Kedu nunca é a organização da demanda");
  assert.deepEqual(read("11.444.777/0001-62"), [], "dígito verificador errado não é corrigido");
  assert.deepEqual(read("11.444.777.000.162,00"), []);
});

test("Sincronização real cadastra a escola e a triagem passa a encontrar o CNPJ", async () => {
  await reset();
  const ticket = raw("7", "Escola Sincronizada Ltda", "11.444.777/0001-61");
  const source = { mode: "real" as const, read: async () => [ticket] };
  const result = await syncGlpi(null, source);
  assert.equal(result.schools.created, 1);
  const school = await sql.one("SELECT * FROM schools");
  const imported = (await listTickets())[0];
  assert.equal(imported.analysis.schoolId, null);
  assert.equal(imported.analysis.organizationId, school.id);
  assert.ok(imported.analysis.pendencies.some((p: string) => p.includes("aguarda classificação")));
  assert.ok(!imported.analysis.pendencies.some((p: string) => p.includes("não está cadastrada")));
  assert.equal((await syncGlpi(null, source)).schools.created, 0);
  assert.equal((await sql.one("SELECT COUNT(*) n FROM schools")).n, 1);
  assert.equal((await sql.one("SELECT COUNT(*) n FROM demands")).n, 1);
  assert.equal((await sql.one("SELECT stage FROM demands")).stage, "Recebido");
});

test("Portal expõe a origem das escolas e restringe a atualização a quem pode cadastrar escolas", async () => {
  const { default: app } = await import("../server/index.js");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.on("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  try {
    for (const [index, role] of ["Consulta", "Solicitante", "Operação"].entries()) {
      const uid = "school-user-" + index;
      const token = "test-school-session-" + index;
      await sql.run("INSERT INTO users VALUES(?,?,?,?,?)", uid, "Usuário de teste", `teste${index}@example.com`, role, "unused");
      await sql.run("INSERT INTO sessions VALUES(?,?,?)", token, uid, Date.now() + 60000);
      const response = await fetch(base + "/glpi/schools/import", { method: "POST", headers: { cookie: "session=" + token, "Content-Type": "application/json" }, body: "{}" });
      assert.equal(response.status, role === "Operação" ? 200 : 403);
      if (role === "Operação") {
        const bootstrap = await fetch(base + "/bootstrap", { headers: { cookie: "session=" + token } });
        const data = await bootstrap.json();
        assert.equal(data.schools.length, 0);
        assert.equal(data.organizations.length, 1);
        assert.equal(data.organizations[0].glpi_ticket, "7");
        assert.ok(data.organizations[0].glpi_imported_at);
        assert.equal(data.organizations[0].organization_kind, "Aguardando classificação");
      }
    }
  } finally { server.close(); }
});

test("Classificação humana protege escolas, fornecedores, permissões, versão e sincronizações", async () => {
  const { default: app } = await import("../server/index.js");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.on("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  const school = await sql.one("SELECT * FROM schools");
  const body = { kind: "Fornecedor", note: "Conferido no contrato de prestação de serviços de teste", expected_version: 1, attested: true };
  const call = (path: string, payload?: unknown, user = "2", method = payload ? "PUT" : "GET") => fetch(base + path, { method, headers: { cookie: "session=test-school-session-" + user, "Content-Type": "application/json" }, body: payload ? JSON.stringify(payload) : undefined });
  try {
    const demandBody = { school_id: school.id, type: "Contrato de garantia", owner: "school-user-2", priority: "Normal", due: "2030-01-01" };
    assert.equal((await call("/demands", demandBody, "2", "POST")).status, 400, "organização pendente não pode virar demanda escolar");
    const path = `/organizations/${school.id}/classification`;
    assert.equal((await call(path, body, "1")).status, 403);
    assert.equal((await call(path, { ...body, attested: false })).status, 400);
    assert.equal((await call(path, body)).status, 200);
    assert.equal((await call(path, body)).status, 409, "edição obsoleta não sobrescreve a categoria");
    let data = await (await call("/bootstrap")).json();
    assert.equal(data.schools.length, 0);
    assert.equal(data.organizations[0].organization_kind, "Fornecedor");
    assert.equal((await call("/demands", demandBody, "2", "POST")).status, 400, "fornecedor não pode virar contrato de garantia");
    assert.equal((await call("/demands", { ...demandBody, type: "Contrato fornecedor" }, "2", "POST")).status, 200);
    await importGlpiSchools(null);
    // Rerunning a migration only applies to SQLite; PostgreSQL receives the imported schema.
    if (sql.dialect === "sqlite") db.exec(readFileSync("migrations/009.sql", "utf8"));
    assert.equal((await sql.one("SELECT kind FROM organization_classifications WHERE school_id=?", school.id)).kind, "Fornecedor", "sincronização e reinício não desfazem classificação");
    assert.equal((await call(path, { ...body, kind: "Escola", expected_version: 2 })).status, 200);
    data = await (await call("/bootstrap")).json();
    assert.equal(data.schools.length, 1);
    assert.equal(data.schools[0].id, school.id);
    assert.equal((await listTickets())[0].analysis.schoolId, school.id);
    assert.equal((await sql.one("SELECT COUNT(*) n FROM schools")).n, 1);
    assert.ok(await sql.one("SELECT id FROM audit WHERE action LIKE 'Organização %→ Escola.%'"));
  } finally { server.close(); }
});
