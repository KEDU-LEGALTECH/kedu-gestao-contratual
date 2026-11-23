import { z } from "zod";
import { sql, id, now, hash, auditAsync } from "./db.js";
import { permit } from "../shared/access-policy.js";

/** Self-service access requests. The account exists from the request on, but stays blocked
 * (user_access) until an administrator approves it and chooses the profile. */
const pendingKey = (userId: string) => "signupPending:" + userId;
const maxPending = 20;
export const roles = ["Administrador", "Solicitante", "Operação", "Jurídico", "Aprovador", "Consulta", "Risco", "Financeiro"] as const;

export async function requestAccess(body: unknown) {
  const b = z.object({
    name: z.string().trim().min(3).max(120),
    email: z.email().max(200),
    password: z.string().min(12).max(200),
  }).parse(body);
  const email = b.email.trim().toLowerCase();
  // Same answer whether or not the e-mail exists, so the form does not reveal who has an account.
  if (await sql.one("SELECT id FROM users WHERE lower(email)=?", email)) return;
  // The per-address limit does not stop requests from many addresses: cap what waits for an administrator.
  if ((await sql.one("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'signupPending:%'")).n >= maxPending)
    throw Object.assign(Error("Há muitos pedidos de acesso aguardando aprovação. Tente novamente mais tarde ou fale com um administrador."), { status: 429 });
  const userId = id();
  await sql.transaction(async () => {
    await sql.run("INSERT INTO users VALUES(?,?,?,?,?)", userId, b.name, email, "Consulta", hash(b.password));
    await sql.run("INSERT INTO user_access(user_id,disabled_at,disabled_by) VALUES(?,?,NULL)", userId, now());
    await sql.run("INSERT INTO settings(key,value) VALUES(?,?)", pendingKey(userId), JSON.stringify({ requestedAt: now() }));
    await auditAsync(null, null, "Pedido de acesso recebido: " + userId);
  });
}

export const isPending = async (userId: string) => !!await sql.one("SELECT key FROM settings WHERE key=?", pendingKey(userId));

async function pendingUser(admin: any, userId: string) {
  permit(admin, "settings");
  if (!await isPending(userId)) throw Error("Este pedido de acesso não está pendente.");
  return userId;
}

/** Releases the account with the profile chosen by the administrator. */
export async function approveAccess(admin: any, userId: string, role: string) {
  await pendingUser(admin, userId);
  const profile = z.enum(roles).parse(role);
  await sql.transaction(async () => {
    await sql.run("UPDATE users SET role=? WHERE id=?", profile, userId);
    await sql.run("DELETE FROM user_access WHERE user_id=?", userId);
    await sql.run("DELETE FROM settings WHERE key=?", pendingKey(userId));
    await auditAsync(null, admin.id, `Pedido de acesso aprovado com perfil ${profile}: ${userId}`);
  });
}

/** Refuses the request; the account stays blocked and can be reactivated later in the users list. */
export async function rejectAccess(admin: any, userId: string) {
  await pendingUser(admin, userId);
  await sql.transaction(async () => {
    await sql.run("UPDATE user_access SET disabled_by=? WHERE user_id=?", admin.id, userId);
    await sql.run("DELETE FROM settings WHERE key=?", pendingKey(userId));
    await auditAsync(null, admin.id, "Pedido de acesso recusado: " + userId);
  });
}
