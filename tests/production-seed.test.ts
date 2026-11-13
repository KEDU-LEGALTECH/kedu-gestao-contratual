import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
function inspect(mode:string, seed:string) {
  return spawnSync(process.execPath,["--import","tsx","--input-type=module","-e",'await import("./server/seed.ts"); const {seedCatalog}=await import("./server/governance-routes.ts"); await seedCatalog(); const {sql}=await import("./server/db.ts"); if((await sql.one("SELECT COUNT(*) n FROM templates")).n) throw Error("Catálogo demonstrativo indevido"); console.log(JSON.stringify({users:(await sql.one("SELECT COUNT(*) n FROM users")).n,demands:(await sql.one("SELECT COUNT(*) n FROM demands")).n})); process.exit(0);'],{encoding:"utf8",env:{...process.env,NODE_ENV:mode,DEMO_SEED:seed,DATABASE_PATH:join(mkdtempSync(join(tmpdir(),"kedu-seed-")),"test.sqlite")}});
}
test("Produção nunca cria contas ou demandas demonstrativas",()=>{
  const result=inspect("production","false");
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()),{users:0,demands:0});
  const forbidden=inspect("production","true");
  assert.notEqual(forbidden.status,0);
  assert.match(forbidden.stderr,/Carga demonstrativa proibida/);
});
test("Desenvolvimento sem ativação explícita também não cria demonstração",()=>{
  const result=inspect("development","");
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()),{users:0,demands:0});
});
