import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "kedu-signup-")), "test.sqlite");
process.env.NODE_ENV = "test";
process.env.DEMO_SEED = "false";
process.env.GLPI_MODE = "demo";
process.env.GLPI_SYNC_TIMES = "";
const { default: app } = await import("../server/index.js");
const { sql, hash } = await import("../server/db.js");
await sql.run("INSERT INTO users VALUES('adm','Admin','adm@test.local','Administrador',?)", hash("senha-do-admin-123"));
const server = app.listen(0, "127.0.0.1");
await new Promise(resolve => server.once("listening", resolve));
after(() => server.close());
const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
const post = (path: string, body: any, cookie = "") => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify(body) });
const login = async (email: string, password: string) => {
  const r = await post("/login", { email, password });
  return { status: r.status, body: await r.json(), cookie: (r.headers.get("set-cookie") || "").split(";")[0] };
};

test("qualquer e-mail pede acesso, mas só entra depois da aprovação do administrador", async () => {
  assert.equal((await post("/signup", { name: "Maria Teste", email: "Maria@Externo.com", password: "curta" })).status, 400);
  assert.equal((await post("/signup", { name: "Maria Teste", email: "Maria@Externo.com", password: "senha-forte-da-maria" })).status, 200);
  const user = await sql.one("SELECT * FROM users WHERE email='maria@externo.com'");
  assert.equal(user.role, "Consulta");
  const blocked = await login("maria@externo.com", "senha-forte-da-maria");
  assert.equal(blocked.status, 403);
  assert.match(blocked.body.error, /aguarda a aprovação/);
  // Asking again with an existing e-mail neither fails nor reveals the account.
  assert.equal((await post("/signup", { name: "Outra", email: "adm@test.local", password: "senha-forte-de-outra" })).status, 200);
  assert.equal((await sql.one("SELECT COUNT(*) n FROM users WHERE email='adm@test.local'")).n, 1);

  const admin = await login("adm@test.local", "senha-do-admin-123");
  const listed = await (await fetch(base + "/bootstrap", { headers: { cookie: admin.cookie } })).json();
  assert.equal(listed.users.find((u: any) => u.id === user.id).pending, 1);
  assert.equal((await post(`/users/${user.id}/approve`, { role: "Jurídico" }, admin.cookie)).status, 200);
  const approved = await login("Maria@Externo.com", "senha-forte-da-maria");
  assert.equal(approved.status, 200);
  assert.equal(approved.body.role, "Jurídico");
  assert.equal((await post(`/users/${user.id}/approve`, { role: "Jurídico" }, admin.cookie)).status >= 400, true, "pedido já decidido");
});

test("pedido recusado continua bloqueado e o solicitante não aprova a si mesmo", async () => {
  await post("/signup", { name: "João Teste", email: "joao@externo.com", password: "senha-forte-do-joao" });
  const joao = await sql.one("SELECT id FROM users WHERE email='joao@externo.com'");
  const admin = await login("adm@test.local", "senha-do-admin-123");
  assert.equal((await post(`/users/${joao.id}/approve`, { role: "Administrador" })).status, 401);
  assert.equal((await post(`/users/${joao.id}/reject`, {}, admin.cookie)).status, 200);
  const refused = await login("joao@externo.com", "senha-forte-do-joao");
  assert.equal(refused.status, 403);
  assert.match(refused.body.error, /Acesso desativado/);
});
