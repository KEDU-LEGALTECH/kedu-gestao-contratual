import "dotenv/config";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import {
  randomUUID,
  scryptSync,
  timingSafeEqual,
  randomBytes,
} from "node:crypto";
mkdirSync("data", { recursive: true });
export const db = new DatabaseSync(
  process.env.DATABASE_PATH || "data/kedu.sqlite",
);
db.exec(readFileSync("migrations/001.sql", "utf8"));
db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
db.exec(readFileSync("migrations/002.sql", "utf8"));
db.exec(readFileSync("migrations/003.sql", "utf8"));
db.exec(readFileSync("migrations/004.sql", "utf8"));
db.exec(readFileSync("migrations/005.sql", "utf8"));
db.exec(readFileSync("migrations/006.sql", "utf8"));
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
