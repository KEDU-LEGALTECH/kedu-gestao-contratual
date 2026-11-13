// Runs test files against a local PostgreSQL. Each file gets a throwaway database cloned from a
// template whose schema comes from the SQLite migrations, converted exactly as the importer does.
// Usage: KEDU_TEST_PG_URL=postgres://user:pass@localhost:5432/postgres tsx scripts/test-postgres.ts [files...]
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import postgres from "postgres";
import { postgresSchema } from "./postgres-rehearsal.js";

const admin = new URL(process.env.KEDU_TEST_PG_URL || "postgres://kedu_test:kedu_test@localhost:5432/postgres");
if (!["localhost", "127.0.0.1"].includes(admin.hostname)) throw Error("Os testes só rodam em PostgreSQL local.");
const template = "kedu_test_template";
const databaseUrl = (name: string) => Object.assign(new URL(admin), { pathname: "/" + name }).toString();

async function buildTemplate() {
  // A fresh SQLite database with every migration applied is the schema source.
  const folder = mkdtempSync(join(tmpdir(), "kedu-pg-schema-"));
  const path = join(folder, "schema.sqlite");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "-e", "await import('./server/sqlite-db.ts')"],
      { env: { ...process.env, DATABASE_PATH: path, KEDU_DATABASE: "" }, stdio: "inherit" });
    child.on("exit", code => code ? reject(Error("Migrações SQLite falharam.")) : resolve());
  });
  const source = new DatabaseSync(path, { readOnly: true });
  const entries = source.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as any[];
  source.close();
  rmSync(folder, { recursive: true, force: true });
  const schema = postgresSchema(entries);
  const root = postgres(admin.toString(), { max: 1, onnotice: () => {} });
  await root.unsafe(`DROP DATABASE IF EXISTS ${template}`);
  await root.unsafe(`CREATE DATABASE ${template}`);
  await root.end();
  const sql = postgres(databaseUrl(template), { max: 1, onnotice: () => {} });
  for (const ddl of [...schema.statements, ...schema.constraints]) await sql.unsafe(ddl);
  await sql.end();
}

function runFile(file: string, database: string) {
  return new Promise<{ file: string; code: number; output: string }>(resolve => {
    const child = spawn(process.execPath, ["--import", "tsx", "--test", "--test-reporter=spec", file], {
      env: { ...process.env, KEDU_DATABASE: "postgres", KEDU_PG_URL: databaseUrl(database), KEDU_PG_SCHEMA: "public", KEDU_PG_POOL: "2" },
    });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    child.on("exit", code => resolve({ file, code: code ?? 1, output }));
  });
}

async function main() {
  // The demo cleanup tool works on the SQLite file itself (triggers, sqlite_master) and is not part of the portal.
  const sqliteOnly = new Set(["tests/cleanup-demo.test.ts"]);
  const files = process.argv.slice(2).length ? process.argv.slice(2)
    : readdirSync("tests").filter(f => f.endsWith(".test.ts")).map(f => "tests/" + f).filter(f => !sqliteOnly.has(f));
  await buildTemplate();
  const root = postgres(admin.toString(), { max: 4, onnotice: () => {} });
  const results: Awaited<ReturnType<typeof runFile>>[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < files.length) {
      const file = files[next++];
      const database = "kedu_test_" + Math.random().toString(36).slice(2, 10);
      await root.unsafe(`CREATE DATABASE ${database} TEMPLATE ${template}`);
      try { results.push(await runFile(file, database)); }
      finally { await root.unsafe(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`); }
    }
  }));
  await root.end();
  let pass = 0, fail = 0;
  for (const r of results.sort((a, b) => a.file.localeCompare(b.file))) {
    pass += Number(/ℹ pass (\d+)/.exec(r.output)?.[1] ?? 0);
    fail += Number(/ℹ fail (\d+)/.exec(r.output)?.[1] ?? 0);
    if (r.code) console.log(`\n=== ${r.file}\n` + r.output.split("\n").filter(l => /✖|Error|error|rror:/.test(l)).slice(0, 12).join("\n"));
  }
  console.log(`\nPostgreSQL: ${pass} aprovados, ${fail} com falha, ${results.filter(r => r.code).length} de ${results.length} arquivos com problema.`);
  process.exitCode = results.some(r => r.code) ? 1 : 0;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
