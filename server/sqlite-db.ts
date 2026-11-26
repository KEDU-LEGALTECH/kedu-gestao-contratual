import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { portableMigrations } from "./migrations.js";
mkdirSync("data", { recursive: true });
/** The local SQLite database with its schema migrations applied. */
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
db.exec(readFileSync("migrations/016.sql", "utf8"));
db.exec(readFileSync("migrations/017.sql", "utf8"));
if(!(db.prepare('PRAGMA table_info(reading_jobs)').all() as any[]).some(c=>c.name==='progress'))db.exec(readFileSync('migrations/018.sql','utf8'));
db.exec(readFileSync("migrations/019.sql", "utf8"));
for (const migration of portableMigrations()) db.exec(migration.sql);
if (!(db.prepare("SELECT sql FROM sqlite_master WHERE name='contract_processing'").get() as any).sql.includes("Conferência parcial")) {
 db.exec(`BEGIN IMMEDIATE;
 CREATE TABLE contract_processing_next(
 demand_id TEXT PRIMARY KEY REFERENCES demands(id),ticket_hash TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('Analisando','Aguardando análise','Conferência parcial','Aguardando correção','Sem erros','Pendências de cadastro','Pronto para download')),
 revision INTEGER NOT NULL DEFAULT 1,overrides TEXT NOT NULL DEFAULT '{}',template_id TEXT,
 result TEXT NOT NULL DEFAULT '{}',updated TEXT NOT NULL);
 INSERT INTO contract_processing_next SELECT * FROM contract_processing;
 DROP TABLE contract_processing;
 ALTER TABLE contract_processing_next RENAME TO contract_processing;
 COMMIT;`);
}
