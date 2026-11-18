import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "kedu-organization-link-")), "test.sqlite");
process.env.NODE_ENV = "test";
process.env.DEMO_SEED = "false";
process.env.GLPI_MODE = "demo";
const { sql } = await import("../server/db.js");
const { importGlpiSchools, linkPendingOrganizations } = await import("../server/glpi-schools.js");
function raw(externalId: string, name: string, cnpj: string) {
  return { externalId, title: "Aditivo de vigência", content: `<p>RAZÃO SOCIAL: ${name}</p><p>CNPJ: ${cnpj}</p>`, status: "2", created: "", updated: "", category: "", groups: ["JURIDICO CONTRATOS"], followups: [], documents: [], documentsAvailable: true };
}
async function store(ticket: ReturnType<typeof raw>) {
  await sql.run("INSERT INTO glpi_tickets VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", ticket.externalId, "real", ticket.title, ticket.status, "hash-" + ticket.externalId, JSON.stringify(ticket), "{}", "novo", null, "2026-10-20", "2026-10-20", null);
}

test("Demanda sem organização é vinculada quando o CNPJ é corrigido ou um documento desempata os CNPJs do chamado", async () => {
  await store(raw("8", "Escola Numérica Ltda", "11.444.777.000.161,00"));
  await store(raw("9", "Colégio A Ltda , Colégio B Ltda", "11.222.333/0001-81 , 01.234.567/0001-95"));
  await store(raw("10", "Escola Ambígua", "11.222.333/0001-81 / 01.234.567/0001-95"));
  for (const ticket of ["8", "9", "10"]) {
    await sql.run("INSERT INTO demands(id,glpi_id,school_id,type,stage,priority,owner,due,data,created) VALUES(?,?,?,?,?,?,?,?,?,?)", "d" + ticket, ticket, null, "Aditivo", "Recebido", "Normal", null, "", "{}", "2026-10-20");
    await sql.run("UPDATE glpi_tickets SET demand_id=? WHERE external_id=?", "d" + ticket, ticket);
  }
  const contract = { version: 2, text: "CONTRATANTE: COLÉGIO B LTDA, inscrita no CNPJ 01.234.567/0001-95, com sede na Rua Teste", fields: { cnpj: ["01.234.567/0001-95"] }, method: "DOCX" };
  await sql.run("INSERT INTO processing_files VALUES(?,?,?,?,?,?,?,?,?,?)", "f9", "d9", "1", "hash-9", "contrato.docx", "application/octet-stream", Buffer.from("x"), JSON.stringify(contract), "", "2026-10-20");
  const result = await importGlpiSchools(null);
  assert.equal(result.created, 2, "o CNPJ corrigido e o CNPJ comprovado pelo contrato viram organizações");
  assert.equal(await linkPendingOrganizations(null), 2);
  const linked = async (id: string) => (await sql.one("SELECT s.cnpj,s.name FROM demands d LEFT JOIN schools s ON s.id=d.school_id WHERE d.id=?", id));
  assert.equal((await linked("d8")).cnpj, "11.444.777/0001-61");
  assert.deepEqual({ ...await linked("d9") }, { cnpj: "01.234.567/0001-95", name: "COLÉGIO B LTDA" }, "o nome vem da parte qualificada no contrato");
  assert.equal((await linked("d10")).cnpj, null, "sem documento que desempate, a escolha fica para o recebimento");
  assert.ok(await sql.one("SELECT id FROM audit WHERE demand_id='d9' AND action LIKE 'Organização vinculada automaticamente%documento%'"));
  await sql.run("UPDATE demands SET school_id=NULL, confirmed=1 WHERE id='d8'");
  assert.equal(await linkPendingOrganizations(null), 0, "recebimento já confirmado não é alterado");
});
