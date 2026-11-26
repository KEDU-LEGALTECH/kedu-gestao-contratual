import "dotenv/config";
import type { DatabaseSync } from "node:sqlite";
import { sqliteSql, type Sql } from "./sql.js";
import {
  randomUUID,
  scryptSync,
  timingSafeEqual,
  randomBytes,
  createHash,
} from "node:crypto";
/** KEDU_DATABASE=postgres switches the portal to Supabase; SQLite stays the default. */
export const postgresMode = process.env.KEDU_DATABASE === "postgres";
// In PostgreSQL mode any leftover synchronous SQLite access fails loudly instead of writing elsewhere.
const sqliteUnavailable = () => new Proxy({} as DatabaseSync, { get() { throw Error("SQLite indisponível: o portal está configurado com KEDU_DATABASE=postgres."); } });
export const db: DatabaseSync = postgresMode ? sqliteUnavailable() : (await import("./sqlite-db.js")).db;
// Production runs on Supabase: a script started with the local .env reads this copy, not production.
if (!postgresMode && process.env.NODE_ENV !== "test" && !process.env.NODE_TEST_CONTEXT)
  console.warn(`Banco: SQLite local (${process.env.DATABASE_PATH || "data/kedu.sqlite"}), não o Supabase de produção.`);
/** Async access used by converted modules; on SQLite the same connection as `db`. */
export const sql: Sql = postgresMode ? await (await import("./postgres-db.js")).openPostgres() : sqliteSql(db);
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export const localDate = (value: string | Date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
export const all = (q: string, ...p: any[]) => db.prepare(q).all(...p) as any[];
export const one = (q: string, ...p: any[]) => db.prepare(q).get(...p) as any;
export const run = (q: string, ...p: any[]) => db.prepare(q).run(...p);
export function hash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
export function verify(password: string, stored: string) {
  const [salt, key] = String(stored || "").split(":");
  // A malformed stored value is a failed sign-in, not a server error.
  if (!salt || !/^[0-9a-f]{128}$/i.test(key || "")) return false;
  return timingSafeEqual(
    scryptSync(password, salt, 64),
    Buffer.from(key, "hex"),
  );
}
/** Sessions are stored by the hash of their token: a copy of the table does not sign anyone in. */
export const sessionKey = (token: string) => createHash("sha256").update(String(token || "")).digest("hex");
export function audit(demand: string | null, user: string | null, action: string) {
  run("INSERT INTO audit VALUES(?,?,?,?,?)", id(), demand, user, action, now());
}
export async function auditAsync(demand: string | null, user: string | null, action: string) {
  await sql.run("INSERT INTO audit VALUES(?,?,?,?,?)", id(), demand, user, action, now());
}
