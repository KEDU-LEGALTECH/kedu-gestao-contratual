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
db.exec(readFileSync("migrations/007.sql", "utf8"));
db.exec(readFileSync("migrations/008.sql", "utf8"));
db.exec(readFileSync("migrations/009.sql", "utf8"));
// An incoming GLPI request can lack an identifiable institution. Keep it as a demand
// without inventing a school, contract, deadline or addendum reservation.
if ((db.prepare("PRAGMA table_info(demands)").all() as any[]).some(c => ["school_id", "owner"].includes(c.name) && c.notnull)) {
  db.exec("PRAGMA foreign_keys=OFF");
  try {
    db.exec("BEGIN IMMEDIATE");
    const dependents = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name='demands' AND type IN('index','trigger') AND sql IS NOT NULL").all() as any[];
    const original = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='demands'").get() as any).sql;
    db.exec("DROP VIEW IF EXISTS contract_registry");
    db.exec(original.replace(/CREATE TABLE\s+(?:"demands"|`demands`|\[demands\]|demands)/i, "CREATE TABLE demands_rebuild").replace(/school_id TEXT NOT NULL/i, "school_id TEXT").replace(/owner TEXT NOT NULL/i, "owner TEXT"));
    db.exec("INSERT INTO demands_rebuild SELECT * FROM demands; DROP TABLE demands; ALTER TABLE demands_rebuild RENAME TO demands;");
    for (const item of dependents) db.exec(item.sql);
    db.exec(readFileSync("migrations/007.sql", "utf8"));
    if (db.prepare("PRAGMA foreign_key_check").all().length) throw Error("Migração de recebimento GLPI com falha de integridade.");
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  finally { db.exec("PRAGMA foreign_keys=ON"); }
}
db.exec(readFileSync("migrations/010.sql", "utf8"));
db.exec(readFileSync("migrations/011.sql", "utf8"));
db.exec(readFileSync("migrations/012.sql", "utf8"));
db.exec(readFileSync("migrations/013.sql", "utf8"));
db.exec(readFileSync("migrations/014.sql", "utf8"));
db.exec(readFileSync("migrations/015.sql", "utf8"));
if (!(db.prepare("SELECT sql FROM sqlite_master WHERE name='contract_processing'").get() as any).sql.includes("Aguardando análise")) {
 db.exec(`BEGIN IMMEDIATE;
 CREATE TABLE contract_processing_next(
 demand_id TEXT PRIMARY KEY REFERENCES demands(id),ticket_hash TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('Analisando','Aguardando análise','Aguardando correção','Pronto para download')),
 revision INTEGER NOT NULL DEFAULT 1,overrides TEXT NOT NULL DEFAULT '{}',template_id TEXT,
 result TEXT NOT NULL DEFAULT '{}',updated TEXT NOT NULL);
 INSERT INTO contract_processing_next SELECT * FROM contract_processing;
 DROP TABLE contract_processing;
 ALTER TABLE contract_processing_next RENAME TO contract_processing;
 COMMIT;`);
}
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
