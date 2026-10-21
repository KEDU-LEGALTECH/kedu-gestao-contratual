import "dotenv/config";
import { DatabaseSync, backup } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";

// Online backup includes committed WAL contents. Never copy only the live .sqlite file.
const source = resolve(process.env.DATABASE_PATH || "data/kedu.sqlite");
const folder = resolve("data/backups");
mkdirSync(folder, { recursive: true });
const target = join(folder, "kedu-" + new Date().toISOString().replace(/[:.]/g, "-") + ".sqlite");
const live = new DatabaseSync(source, { readOnly: true });
try {
  await backup(live, target);
  const restored = new DatabaseSync(target, { readOnly: true });
  try {
    const integrity = restored.prepare("PRAGMA integrity_check").all() as any[];
    if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") throw Error("Backup falhou na verificação de integridade.");
    if (restored.prepare("PRAGMA foreign_key_check").all().length) throw Error("Backup contém referências inconsistentes.");
    const demands = restored.prepare("SELECT COUNT(*) n FROM demands").get() as any;
    console.log("Backup consistente criado e reaberto com sucesso: " + target);
    console.log("Integridade e referências verificadas. Demandas recuperáveis: " + demands.n);
  } finally { restored.close(); }
} finally { live.close(); }
