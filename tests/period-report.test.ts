import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "kedu-period-")), "test.sqlite");
process.env.NODE_ENV = "test";
process.env.DEMO_SEED = "false";
process.env.GLPI_MODE = "demo";
const { sql, now } = await import("../server/db.js");
const { periodChanges } = await import("../server/period-report.js");

await sql.run("INSERT INTO users VALUES('adm','Admin','adm@test.local','Administrador','x')");
await sql.run("INSERT INTO users VALUES('sol','Sol','sol@test.local','Solicitante','x')");
await sql.run("INSERT INTO schools VALUES('s','Escola Alfa','Escola Alfa','11.444.777/0001-61','','')");
async function ticket(id: string, owner: string, history: [string, string][]) {
  await sql.run("INSERT INTO demands(id,glpi_id,school_id,type,stage,priority,owner,due,data,created) VALUES(?,?,'s','Aditivo','Recebido','Normal',?,'','{}',?)", "d" + id, id, owner, now());
  await sql.run("INSERT INTO glpi_tickets VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", id, "real", "Chamado " + id, history.at(-1)![1], "h" + history.length, "{}", "{}", "vinculado", "d" + id, now(), now(), null);
  for (const [i, [seen, status]] of history.entries())
    await sql.run("INSERT INTO glpi_ticket_versions VALUES(?,?,?,?,?)", id + "-" + i, id, "h" + i, JSON.stringify({ status }), seen);
}
// Times in UTC; 02:00Z on the 18th is still the 17th in Brasília.
await ticket("100", "adm", [["2026-11-17T13:00:00Z", "2"], ["2026-11-18T02:00:00Z", "4"], ["2026-11-19T13:00:00Z", "2"], ["2026-11-20T13:00:00Z", "5"], ["2026-11-21T13:00:00Z", "6"]]);
await ticket("200", "sol", [["2026-11-19T13:00:00Z", "4"]]);
await sql.run("INSERT INTO audit VALUES(?,?,?,?,?)", "a1", "d100", null, "Conferência: Aguardando correção → Sem erros", "2026-11-20T15:00:00Z");
await sql.run("INSERT INTO audit VALUES(?,?,?,?,?)", "a2", "d100", "adm", "Demanda finalizada manualmente (Resolvido no GLPI): ok", "2026-11-21T15:00:00Z");

test("relatório por período conta movimentos do GLPI e decisões do portal no horário de Brasília", async () => {
  const r = await periodChanges({ role: "Administrador" }, "2026-11-17", "2026-11-21", "day");
  assert.deepEqual(r.totals, { novo: 2, andamento_pendente: 1, pendente_andamento: 1, solucionado: 1, conferencia: 1, finalizado: 1 }, "fechar depois de solucionar não conta de novo");
  assert.deepEqual(r.buckets.find(b => b.key === "2026-11-17")!.counts, { novo: 1, andamento_pendente: 1 });
  const week = await periodChanges({ role: "Administrador" }, "2026-11-17", "2026-11-21", "week");
  assert.deepEqual(week.buckets.map(b => b.key), ["2026-11-16"]);
  const today = await periodChanges({ role: "Administrador" }, "2026-11-19", "2026-11-19", "day");
  assert.deepEqual(today.totals, { novo: 1, pendente_andamento: 1 });
});

test("solicitante vê só as próprias demandas e período inválido é recusado", async () => {
  const r = await periodChanges({ id: "sol", role: "Solicitante" }, "2026-11-01", "2026-11-30", "month");
  assert.deepEqual(r.totals, { novo: 1 });
  assert.equal(r.buckets[0].key, "2026-11");
  await assert.rejects(periodChanges({ role: "Administrador" }, "2026-11-30", "2026-11-01", "day"), /Período inválido/);
});
