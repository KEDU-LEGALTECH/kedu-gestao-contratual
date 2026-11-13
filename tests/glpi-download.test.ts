import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "kedu-download-")), "test.sqlite");
process.env.NODE_ENV = "test";
process.env.DEMO_SEED = "false";
process.env.GLPI_MODE = "real";
process.env.GLPI_GROUP_IDS = "149";
process.env.GLPI_GROUPS = "";
process.env.GLPI_APP_TOKEN = "fake-app";
process.env.GLPI_USER_TOKEN = "fake-user";
process.env.GLPI_RETRIES = "0";
const bytes = Buffer.from("PK\x03\x04arquivo fictício de teste");
const calls: { path: string; method: string; media: boolean }[] = [];
let permitted = true, linked = true, fileDenied = false, followupVisible = false;
const glpi = createServer((req, res) => {
  const url = new URL(req.url!, "http://test");
  const path = url.pathname.replace("/apirest.php/", "");
  const media = url.searchParams.get("alt") === "media";
  calls.push({ path, method: req.method!, media });
  const json = (body: unknown, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  if (path === "initSession") {
    assert.equal(req.headers.authorization, "user_token fake-user");
    return json({ session_token: "fake-session" });
  }
  assert.equal(req.headers["session-token"], "fake-session");
  assert.equal(req.headers["app-token"], "fake-app");
  if (path === "killSession") return json(true);
  if (path === "Ticket/1001/Group_Ticket") return json([{ groups_id: permitted ? 149 : 999, type: 2 }]);
  if (path === "Ticket/1001/Document_Item") return json(linked ? [{ documents_id: 51 }] : []);
  if (path === "Ticket/1001/ITILFollowup") return json(followupVisible ? [{ id: 9 }] : []);
  if (path === "ITILFollowup/9/Document_Item") return json([{ documents_id: 51 }]);
  if (path === "Document/51") {
    if (!media) return json({ filename: "arquivo.docx" });
    if (fileDenied) return json(["ERROR_RIGHT_MISSING", "sem direito"], 403);
    assert.equal(req.headers.accept, "application/octet-stream");
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    return res.end(bytes);
  }
  return json([], 404);
});
glpi.listen(0, "127.0.0.1");
await new Promise<void>(resolve => glpi.on("listening", resolve));
process.env.GLPI_URL = `http://127.0.0.1:${(glpi.address() as any).port}/apirest.php`;
const { default: app } = await import("../server/index.js");
const { run, one, sql } = await import("../server/db.js");
const { GlpiClient, glpiConfig } = await import("../server/glpi.js");
await sql.run("INSERT INTO glpi_tickets VALUES('1001','real','Chamado real de teste','2','hash',?,'{}','novo',NULL,'2026-10-20','2026-10-20',NULL)", JSON.stringify({ documents: [{ id: "51", name: "arquivo.docx" }], groups: ["JURIDICO CONTRATOS"] }));
for (const [id, role] of [["admin", "Administrador"], ["requester", "Solicitante"], ["reader", "Consulta"]]) {
  await sql.run("INSERT INTO users VALUES(?,?,?,?,?)", id, "Teste " + role, id + "@example.com", role, "unused");
  await sql.run("INSERT INTO sessions VALUES(?,?,?)", "session-" + id, id, Date.now() + 60000);
}
const server = app.listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.on("listening", resolve));
after(() => { server.close(); glpi.close(); });
const base = `http://127.0.0.1:${(server.address() as any).port}/api/glpi/tickets/1001/documents/`;
const download = (document = "51", role = "admin") => fetch(base + document + "/download", { headers: { cookie: "session=session-" + role } });

test("Download autenticado devolve os bytes originais e registra auditoria, usando somente GET", async () => {
  const response = await download();
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  assert.match(response.headers.get("content-disposition")!, /attachment.*arquivo\.docx/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.ok(calls.every(c => c.method === "GET"));
  assert.equal(calls.at(-1)?.path, "killSession");
  assert.ok((await sql.one("SELECT id FROM audit WHERE action LIKE 'Download de anexo GLPI #1001%'"))?.id);
});
test("Perfis sem permissão de arquivos não acessam a API remota", async () => {
  const before = calls.length;
  assert.equal((await download("51", "requester")).status, 403);
  assert.equal((await download("51", "reader")).status, 403);
  assert.equal(calls.length, before);
});
test("Não aceita documento arbitrário, grupo não autorizado ou vínculo removido", async () => {
  const before = calls.length;
  assert.equal((await download("52")).status, 404);
  assert.equal(calls.length, before);
  permitted = false;
  assert.equal((await download()).status, 403);
  permitted = true;
  linked = false;
  assert.equal((await download()).status, 404);
  linked = true;
  assert.equal(calls.filter(c => c.media).length, 1, "somente o primeiro teste conseguiu chegar ao arquivo");
});
test("Negativa de permissão do GLPI é exibida como erro e a sessão é encerrada", async () => {
  fileDenied = true;
  const response = await download();
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /HTTP 403/);
  assert.doesNotMatch(body.error, /fake-user|fake-app|fake-session/);
  assert.equal(calls.at(-1)?.path, "killSession");
  fileDenied = false;
});
test("Anexo da conversa verifica somente a origem registrada e recusa uma origem removida", async () => {
  const previous = (await sql.one("SELECT payload FROM glpi_tickets WHERE external_id='1001'")).payload;
  const { downloadGlpiAttachment } = await import("../server/glpi-download.js");
  await sql.run("UPDATE glpi_tickets SET payload=? WHERE external_id='1001'", JSON.stringify({
    ...JSON.parse(previous), documentLinks: { "9": ["51"] },
  }));
  linked = false;
  followupVisible = true;
  try {
    const start = calls.length;
    assert.deepEqual((await downloadGlpiAttachment("1001", "51", AbortSignal.timeout(5000))).bytes, bytes);
    assert.deepEqual(calls.slice(start).map(c => c.path), [
      "initSession", "Ticket/1001/Group_Ticket", "Ticket/1001/Document_Item", "Ticket/1001/ITILFollowup",
      "ITILFollowup/9/Document_Item", "Document/51", "Document/51", "killSession",
    ]);
    followupVisible = false;
    const startRemoved = calls.length;
    await assert.rejects(downloadGlpiAttachment("1001", "51", AbortSignal.timeout(5000)), { status: 404 });
    assert.ok(!calls.slice(startRemoved).some(c => c.path === "ITILFollowup/9/Document_Item" || c.media));
  } finally {
    linked = true;
    followupVisible = false;
    await sql.run("UPDATE glpi_tickets SET payload=? WHERE external_id='1001'", previous);
  }
});
test("Limite de bytes impede arquivos excessivos mesmo sem Content-Length", async () => {
  let canceled = false;
  const fake: typeof fetch = async input => {
    if (String(input).endsWith("initSession")) return new Response(JSON.stringify({ session_token: "fake" }));
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(8)); }, cancel() { canceled = true; } }), { headers: { "Content-Type": "application/octet-stream" } });
  };
  const client = new GlpiClient(glpiConfig(), fake);
  await client.open();
  await assert.rejects(client.downloadDocument("51", AbortSignal.timeout(1000), 4), /excede o limite/);
  assert.ok(canceled);
});
