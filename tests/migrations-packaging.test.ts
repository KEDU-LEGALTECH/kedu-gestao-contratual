import { test } from "node:test";
import assert from "node:assert/strict";
import { globSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { portableMigrations } from "../server/migrations.js";

test("o pacote da função Vercel inclui todas as migrações portáveis", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  const included = new Set([...globSync(config.functions["api/index.ts"].includeFiles, { cwd: root })].map(path => path.replaceAll("\\", "/")));
  const migrations = portableMigrations();
  assert.ok(migrations.length > 0);
  for (const migration of migrations) assert.ok(included.has("migrations/" + migration.name), migration.name);
});

test("migrações são encontradas mesmo fora do diretório do projeto, sem conectar ao banco", () => {
  const cwd = mkdtempSync(join(tmpdir(), "kedu-migrations-cwd-"));
  try {
    const moduleUrl = new URL("../server/migrations.ts", import.meta.url).href;
    const script = `import { portableMigrations } from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(portableMigrations()));`;
    const result = spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), "--input-type=module", "-e", script], {
      cwd: resolve(cwd), encoding: "utf8", timeout: 30_000,
      env: { ...process.env, DOTENV_CONFIG_PATH: join(cwd, "absent.env") },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), portableMigrations());
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
