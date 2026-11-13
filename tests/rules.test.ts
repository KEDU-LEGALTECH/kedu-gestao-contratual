import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "kedu-rules-")), "test.sqlite");
process.env.NODE_ENV = "test";
process.env.DEMO_SEED = "true";
const { default: app } = await import("../server/index.js");
const { one, run, sql } = await import("../server/db.js");
const { requirements, governanceMissing, saveDetails } = await import("../server/governance.js");
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.on("listening", resolve));
after(() => server.close());
const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
async function request(path: string, body?: any, cookie = "") {
  const res = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json(), cookie: res.headers.get("set-cookie")?.split(";")[0] || "" };
}
const admin = (await request("/login", { email: "admin@demo.kedu.local", password: "Kedu-demo-2026!" })).cookie;
async function fake(type: string, data: Record<string, unknown> = {}, subtype = "") {
  const id = "T-" + Math.random().toString(36).slice(2, 10);
  await sql.run("INSERT INTO contracts(id,school_id) VALUES(?,?)", "c-" + id, "s1");
  await sql.run("INSERT INTO demands(id,school_id,contract_id,type,stage,priority,owner,due,data,created) VALUES(?,?,?,?,?,?,?,?,?,?)", id, "s1", "c-" + id, type, "Recebido", "Normal", "u2", "2030-01-01", JSON.stringify(data), new Date().toISOString());
  await saveDetails(id, { subtype, reportDate: "2030-01-04", signers: [], legalFlags: [] });
  return await sql.one("SELECT * FROM demands WHERE id=?", id);
}

test("Matriz de responsabilidades do manual define as validações obrigatórias", async () => {
  const approvals = async (type: string, data = {}, subtype = "") => (await requirements(await fake(type, data, subtype))).approvals;
  assert.deepEqual(await approvals("Contrato de garantia", { modalidade: "Garantia Completa" }), ["Risco"]);
  assert.deepEqual(await approvals("Contrato de garantia", { modalidade: "Garantia Conjunta" }), ["Risco"]);
  assert.deepEqual(await approvals("Contrato de garantia", { modalidade: "Garantia Prevista" }), ["Risco", "Jurídica"]);
  assert.deepEqual(await approvals("Aditivo", {}, "Vigência"), ["Risco"]);
  assert.deepEqual(await approvals("Aditivo", {}, "Conta bancária"), ["Risco", "Financeiro"]);
  assert.deepEqual(await approvals("Antecipação K-invest"), ["Jurídica", "Financeiro"]);
  assert.deepEqual(await approvals("Parcelamento"), ["Jurídica", "Financeiro"]);
  assert.deepEqual(await approvals("Distrato"), ["Jurídica", "Financeiro"]);
  assert.deepEqual(await approvals("Contrato fornecedor"), ["Jurídica"]);
  // Legal exceptions always add the legal control point.
  const flagged = await fake("Contrato de garantia", { modalidade: "Garantia Completa" });
  await saveDetails(flagged.id, { subtype: "", reportDate: "2030-01-04", signers: [], legalFlags: ["Alteração societária"] });
  assert.deepEqual((await requirements(flagged)).approvals, ["Risco", "Jurídica"]);
  assert.ok((await requirements(flagged)).responsibility.fonte.includes("Manual"));
});

test("Migração de modalidade exige distrato e novo contrato vinculados, não aditivo simples", async () => {
  const migration = await fake("Migração de modalidade", { modalidade: "Garantia Prevista" });
  let missing = await governanceMissing(migration);
  assert.ok(missing.includes("Demanda de distrato do contrato vigente vinculada"));
  assert.ok(missing.includes("Demanda do novo contrato na modalidade de destino vinculada"));
  const distrato = await fake("Distrato");
  const novo = await fake("Contrato de garantia", { modalidade: "Garantia Prevista" });
  await sql.run("UPDATE demands SET data=? WHERE id=?", JSON.stringify({ modalidade: "Garantia Prevista", demandaDistrato: distrato.id, demandaNovoContrato: novo.id }), migration.id);
  missing = await governanceMissing(await sql.one("SELECT * FROM demands WHERE id=?", migration.id));
  assert.ok(!missing.some((m) => m.includes("vinculada")));
  await sql.run("UPDATE demands SET stage='Em assinatura' WHERE id=?", migration.id);
  missing = await governanceMissing(await sql.one("SELECT * FROM demands WHERE id=?", migration.id));
  assert.ok(missing.some((m) => m.includes("concluída antes de encerrar a migração")));
});

test("Representante do documento precisa estar entre os signatários conferidos", async () => {
  const d = await fake("Contrato de garantia", { modalidade: "Garantia Completa", representanteNome: "Ana Souza" });
  await saveDetails(d.id, {
    subtype: "",
    reportDate: "2030-01-04",
    signingMode: "Administrador nomeado",
    partnerCount: 1,
    signers: [{ name: "Bruno Lima", email: "b@example.com", capacity: "Administrador" }],
    legalFlags: [],
  });
  assert.ok((await governanceMissing(d)).some((m) => m.startsWith("Representante legal do documento")));
  await saveDetails(d.id, {
    subtype: "",
    reportDate: "2030-01-04",
    signingMode: "Administrador nomeado",
    partnerCount: 1,
    signers: [{ name: "ANA SOUZA", email: "a@example.com", capacity: "Administrador" }],
    legalFlags: [],
  });
  assert.ok(!(await governanceMissing(d)).some((m) => m.startsWith("Representante legal do documento")));
});

test("Encerramento no GLPI é registrado à parte e só após a conclusão local", async () => {
  const open = await fake("Contrato de garantia");
  assert.equal((await request("/demands/" + open.id + "/glpi-closure", { attested: true, note: "Chamado encerrado" }, admin)).status, 400);
  const done = await sql.one("SELECT * FROM demands WHERE stage='Concluído' LIMIT 1");
  assert.equal((await request("/demands/" + done.id + "/glpi-closure", { attested: true, note: "Assinado anexado e chamado encerrado no GLPI" }, admin)).status, 200);
  assert.equal((await request("/demands/" + done.id + "/glpi-closure", { attested: true, note: "Repetido" }, admin)).status, 400);
  assert.ok(await sql.one("SELECT * FROM audit WHERE demand_id=? AND action LIKE '%sem escrita via API%'", done.id));
});
