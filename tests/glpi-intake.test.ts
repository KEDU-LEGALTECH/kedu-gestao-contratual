import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "kedu-intake-")), "test.sqlite");
process.env.NODE_ENV = "test";
process.env.DEMO_SEED = "false";
const { one, run, sql } = await import("../server/db.js");
const { receiveGlpiDemands, intakeForDemand, confirmGlpiIntake } = await import("../server/glpi-intake.js");
const { transition } = await import("../server/workflow.js");
const raw = { externalId: "901", title: "Solicitação incompleta", content: "<p>Solicito análise do documento</p>", status: "2", created: "", updated: "", category: "", groups: [], followups: [], documents: [], documentsAvailable: true };

test("Recebe chamado incompleto sem inventar organização, responsável, prazo ou contrato; não duplica", async () => {
  await sql.run("INSERT INTO glpi_tickets VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", "901", "real", raw.title, "2", "v1", JSON.stringify(raw), "{}", "novo", null, "2026-10-20", "2026-10-20", null);
  assert.equal((await receiveGlpiDemands(null)).created, 1);
  const demand = await sql.one("SELECT * FROM demands WHERE glpi_id='901'");
  assert.equal(demand.school_id, null);
  assert.equal(demand.owner, null);
  assert.equal(demand.contract_id, null);
  assert.equal(demand.due, "");
  assert.equal(demand.stage, "Recebido");
  assert.equal((await intakeForDemand(demand.id)).confirmed_at, null);
  assert.equal((await sql.one("SELECT COUNT(*) n FROM contracts")).n, 0);
  assert.equal((await receiveGlpiDemands(null)).created, 0);
  assert.equal((await sql.one("SELECT demand_id FROM glpi_tickets WHERE external_id='901'")).demand_id, demand.id);
});

test("Recebimento pendente bloqueia avanço; alteração na origem impede confirmação antiga", async () => {
  await sql.run("INSERT INTO users(id,name,email,role,password) VALUES('admin','Admin','intake@test.local','Administrador','unused')");
  const user = await sql.one("SELECT * FROM users WHERE id='admin'");
  const demand = await sql.one("SELECT * FROM demands WHERE glpi_id='901'");
  await assert.rejects(async () => transition(user, demand, "Em elaboração"), /recebimento/i);
  await sql.run("UPDATE glpi_tickets SET hash='v2' WHERE external_id='901'");
  await assert.rejects(async () => confirmGlpiIntake(user, demand, { expected_version: demand.data_version, expected_hash: "v1" }), /mudou/i);
  assert.equal((await sql.one("SELECT COUNT(*) n FROM contracts")).n, 0);
  assert.equal((await receiveGlpiDemands(null)).created, 0);
  assert.equal((await sql.one("SELECT data_version FROM demands WHERE id=?", demand.id)).data_version, demand.data_version);
});


