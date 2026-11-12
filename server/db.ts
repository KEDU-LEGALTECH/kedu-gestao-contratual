import "dotenv/config";
import type { DatabaseSync } from "node:sqlite";
import { sqliteSql, type Sql } from "./sql.js";
import {
  randomUUID,
  scryptSync,
  timingSafeEqual,
  randomBytes,
} from "node:crypto";
/** KEDU_DATABASE=postgres switches the portal to Supabase; SQLite stays the default. */
export const postgresMode = process.env.KEDU_DATABASE === "postgres";
// In PostgreSQL mode any leftover synchronous SQLite access fails loudly instead of writing elsewhere.
const sqliteUnavailable = () => new Proxy({} as DatabaseSync, { get() { throw Error("SQLite indisponível: o portal está configurado com KEDU_DATABASE=postgres."); } });
export const db: DatabaseSync = postgresMode ? sqliteUnavailable() : (await import("./sqlite-db.js")).db;
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
  const [salt, key] = stored.split(":");
  return timingSafeEqual(
    scryptSync(password, salt, 64),
    Buffer.from(key, "hex"),
  );
}
export function audit(demand: string | null, user: string | null, action: string) {
  run("INSERT INTO audit VALUES(?,?,?,?,?)", id(), demand, user, action, now());
}
export async function auditAsync(demand: string | null, user: string | null, action: string) {
  await sql.run("INSERT INTO audit VALUES(?,?,?,?,?)", id(), demand, user, action, now());
}
