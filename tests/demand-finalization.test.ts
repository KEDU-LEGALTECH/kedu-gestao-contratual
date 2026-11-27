import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "kedu-finalization-")), "test.sqlite");
process.env.NODE_ENV = "test";
process.env.DEMO_SEED = "false";
process.env.GLPI_MODE = "demo";
const { sql, now } = await import("../server/db.js");
const { finalization, finalizeDemand, reopenDemand } = await import("../server/demand-finalization.js");

await sql.run("INSERT INTO users VALUES('adm','Admin','adm@test.local','Administrador','x')");
await sql.run("INSERT INTO users VALUES('jur','Jurídico','jur@test.local','Jurídico','x')");
await sql.run("INSERT INTO users VALUES('con','Consulta','con@test.local','Consulta','x')");
await sql.run("INSERT INTO schools VALUES('s','Escola','Escola','11.444.777/0001-61','','')");
await sql.run("INSERT INTO demands(id,glpi_id,school_id,type,stage,priority,owner,due,data,created) VALUES('d1','1','s','Aditivo','Recebido','Normal','adm','','{}',?)", now());
const stage = async () => (await sql.one("SELECT stage FROM demands WHERE id='d1'")).stage;
const user = (id: string, role: string) => ({ id, role, name: id });

test("finalizar exige perfil, forma de resolução e motivo, e fica na auditoria", async () => {
  const d = await sql.one("SELECT * FROM demands WHERE id='d1'");
  await assert.rejects(finalizeDemand(user("con", "Consulta"), d, "Resolvido no GLPI", "Contrato enviado pelo GLPI."), /permissão/);
  await assert.rejects(finalizeDemand(user("jur", "Jurídico"), d, "Outro", "Contrato enviado pelo GLPI."), /Escolha/);
  await assert.rejects(finalizeDemand(user("jur", "Jurídico"), d, "Resolvido no GLPI", "  "), /motivo/);
  await finalizeDemand(user("jur", "Jurídico"), d, "Resolvido no GLPI", "Contrato assinado enviado pelo GLPI.");
  assert.equal(await stage(), "Concluído");
  assert.equal((await finalization("d1")).previous, "Recebido");
  assert.ok(await sql.one("SELECT id FROM audit WHERE demand_id='d1' AND action LIKE 'Demanda finalizada manualmente (Resolvido no GLPI)%'"));
  await assert.rejects(finalizeDemand(user("jur", "Jurídico"), await sql.one("SELECT * FROM demands WHERE id='d1'"), "Resolvido no GLPI", "De novo."), /já está encerrada/);
});

test("só administrador e Jurídico reabrem, e a demanda volta para a etapa anterior", async () => {
  const d = await sql.one("SELECT * FROM demands WHERE id='d1'");
  await assert.rejects(reopenDemand(user("con", "Consulta"), d), /permissão/);
  await reopenDemand(user("adm", "Administrador"), d);
  assert.equal(await stage(), "Recebido");
  assert.equal(await finalization("d1"), null);
  await assert.rejects(reopenDemand(user("adm", "Administrador"), await sql.one("SELECT * FROM demands WHERE id='d1'")), /finalizada manualmente/);
});
