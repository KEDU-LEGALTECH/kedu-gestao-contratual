import { test, after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "kedu-serverless-")), "test.sqlite");
process.env.NODE_ENV = "test";
process.env.DEMO_SEED = "false";
process.env.CRON_SECRET = "segredo-de-teste-do-cron";
// Never reach the real GLPI from tests: demonstration source and no daily slots.
process.env.GLPI_MODE = "demo";
process.env.GLPI_SYNC_TIMES = "";
const { default: app } = await import("../server/index.js");
const { sql } = await import("../server/db.js");
const { ReadingJobQueue } = await import("../server/reading-job-queue.js");

const server = app.listen(0, "127.0.0.1");
await new Promise(resolve => server.on("listening", resolve));
after(() => server.close());
const base = `http://127.0.0.1:${(server.address() as any).port}`;

test("instâncias sobrepostas só retomam leitura parada há mais tempo que qualquer execução", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync("migrations/017.sql", "utf8"));
  db.exec(readFileSync("migrations/018.sql", "utf8"));
  try {
    let time = 1000;
    const first = new ReadingJobQueue(db, () => time, 60000);
    await first.enqueue("a", "hash");
    const job = (await first.claim())!;
    assert.equal(job.demand_id, "a");
    // Another instance starts while the first one is still reading.
    time += 30000;
    const second = new ReadingJobQueue(db, () => time, 60000);
    assert.equal(await second.claim(), undefined, "leitura em andamento não é tomada por outra instância");
    // The first instance was stopped without finishing: after the threshold the job resumes.
    time += 31000;
    await second.recoverStale();
    const resumed = (await second.claim())!;
    assert.equal(resumed.demand_id, "a");
    assert.equal(resumed.attempts, 1, "a retomada não consome tentativa");
  } finally { db.close(); }
});

test("rotas do Vercel Cron exigem o segredo e respeitam a pausa da leitura", async () => {
  const call = (path: string, authorization?: string) =>
    fetch(base + path, { headers: authorization ? { Authorization: authorization } : {} });
  for (const path of ["/api/cron/reading", "/api/cron/glpi-sync"]) {
    assert.equal((await call(path)).status, 401);
    assert.equal((await call(path, "Bearer outro-segredo")).status, 401);
  }
  await sql.run("INSERT INTO settings(key,value) VALUES('documentReadingPaused','true') ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  const reading = await call("/api/cron/reading", "Bearer segredo-de-teste-do-cron");
  assert.equal(reading.status, 200);
  assert.deepEqual(await reading.json(), { paused: true });
  // Without configured daily times there is no slot to run.
  const sync = await call("/api/cron/glpi-sync", "Bearer segredo-de-teste-do-cron");
  assert.equal(sync.status, 200);
  assert.deepEqual(await sync.json(), { synced: false });
});
