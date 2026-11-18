import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "kedu-user-access-")), "test.sqlite");
process.env.NODE_ENV = "test";
process.env.DEMO_SEED = "false";
process.env.GLPI_MODE = "demo";
process.env.GLPI_SYNC_TIMES = "";
const { default: app } = await import("../server/index.js");
const { sql, hash } = await import("../server/db.js");

const server = app.listen(0, "127.0.0.1");
await new Promise(resolve => server.on("listening", resolve));
after(() => server.close());
const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
async function login(email: string, password: string) {
  const response = await fetch(base + "/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  return { status: response.status, cookie: (response.headers.get("set-cookie") || "").split(";")[0], body: await response.json() };
}
const call = (cookie: string, path: string, method: string, body?: unknown) =>
  fetch(base + path, { method, headers: { cookie, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });

await sql.run("INSERT INTO users VALUES(?,?,?,?,?)", "admin", "Administradora", "admin@empresa.test", "Administrador", hash("senha-da-admin-123"));
await sql.run("INSERT INTO users VALUES(?,?,?,?,?)", "ana", "Ana", "ana@empresa.test", "Jurídico", hash("senha-inicial-123"));

test("usuário troca a própria senha conferindo a atual e as outras sessões são encerradas", async () => {
  const first = await login("ana@empresa.test", "senha-inicial-123");
  const second = await login("ana@empresa.test", "senha-inicial-123");
  assert.equal((await call(first.cookie, "/me/password", "POST", { current: "errada", password: "nova-senha-da-ana-1" })).status, 400);
  assert.equal((await call(first.cookie, "/me/password", "POST", { current: "senha-inicial-123", password: "curta" })).status, 400);
  assert.equal((await call(first.cookie, "/me/password", "POST", { current: "senha-inicial-123", password: "nova-senha-da-ana-1" })).status, 200);
  assert.equal((await call(first.cookie, "/me", "GET")).status, 200, "a sessão que trocou a senha continua");
  assert.equal((await call(second.cookie, "/me", "GET")).status, 401, "outra sessão com a senha antiga é encerrada");
  assert.equal((await login("ana@empresa.test", "senha-inicial-123")).status, 401);
  assert.equal((await login("ana@empresa.test", "nova-senha-da-ana-1")).status, 200);
});

test("administrador redefine senha, desativa e reativa acesso, sem deixar o portal sem administrador", async () => {
  const admin = await login("admin@empresa.test", "senha-da-admin-123");
  const ana = await login("ana@empresa.test", "nova-senha-da-ana-1");
  assert.equal((await call(ana.cookie, "/users/admin/access", "PUT", { active: false })).status, 403, "só quem administra usuários");
  assert.equal((await call(admin.cookie, "/users/ana/password", "PUT", { password: "redefinida-pela-admin" })).status, 200);
  assert.equal((await call(ana.cookie, "/me", "GET")).status, 401, "redefinição encerra as sessões da pessoa");
  const again = await login("ana@empresa.test", "redefinida-pela-admin");
  assert.equal(again.status, 200);

  assert.equal((await call(admin.cookie, "/users/ana/access", "PUT", { active: false })).status, 200);
  assert.equal((await call(again.cookie, "/me", "GET")).status, 401, "desativação encerra a sessão aberta");
  const blocked = await login("ana@empresa.test", "redefinida-pela-admin");
  assert.equal(blocked.status, 403);
  assert.match(blocked.body.error, /desativado/);
  const users = (await (await call(admin.cookie, "/bootstrap", "GET")).json()).users;
  assert.equal(users.find((u: any) => u.id === "ana").active, 0);

  assert.equal((await call(admin.cookie, "/users/ana/access", "PUT", { active: true })).status, 200);
  assert.equal((await login("ana@empresa.test", "redefinida-pela-admin")).status, 200);

  assert.equal((await call(admin.cookie, "/users/admin/access", "PUT", { active: false })).status, 400, "ninguém desativa a própria conta");
  assert.equal((await call(admin.cookie, "/users/admin/password", "PUT", { password: "outra-senha-qualquer" })).status, 400, "a própria senha passa pela senha atual");
  await sql.run("UPDATE users SET role='Administrador' WHERE id='ana'");
  const anaAdmin = await login("ana@empresa.test", "redefinida-pela-admin");
  assert.equal((await call(anaAdmin.cookie, "/users/admin/access", "PUT", { active: false })).status, 200, "com outra administradora ativa");
  assert.equal((await call(anaAdmin.cookie, "/users/admin/role", "PUT", { role: "Consulta" })).status, 200);
  await sql.run("INSERT INTO users VALUES(?,?,?,?,?)", "bia", "Bia", "bia@empresa.test", "Administrador", hash("senha-da-bia-1234"));
  const bia = await login("bia@empresa.test", "senha-da-bia-1234");
  assert.equal((await call(bia.cookie, "/users/ana/access", "PUT", { active: false })).status, 200);
  assert.equal((await call(anaAdmin.cookie, "/me", "GET")).status, 401);
  await sql.run("UPDATE users SET role='Administrador' WHERE id='admin'");
  assert.equal((await call(bia.cookie, "/users/admin/role", "PUT", { role: "Consulta" })).status, 200, "administrador desativado não conta como ativo, mas pode mudar de perfil");
  await sql.run("DELETE FROM user_access WHERE user_id='ana'");
  const anaBack = await login("ana@empresa.test", "redefinida-pela-admin");
  assert.equal((await call(anaBack.cookie, "/users/bia/access", "PUT", { active: false })).status, 200, "outra administradora ativa permanece");
  assert.equal((await call(anaBack.cookie, "/users/bia/access", "PUT", { active: true })).status, 200);
  const audit = await sql.all("SELECT action FROM audit WHERE action LIKE '%usuário%' OR action LIKE 'Senha%'");
  assert.ok(audit.some((a: any) => /Senha alterada pelo próprio usuário/.test(a.action)));
  assert.ok(audit.some((a: any) => /Acesso de usuário desativado/.test(a.action)));
});
