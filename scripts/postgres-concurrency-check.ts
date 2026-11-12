import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { allocatePostgresAddendum } from "../server/postgres-addendum.js";
import { PostgresReadingQueue } from "../server/postgres-reading-queue.js";

async function main() {
  const url = new URL(process.env.KEDU_REHEARSAL_DATABASE_URL ?? "");
  if (!["postgresql:", "postgres:"].includes(url.protocol) ||
      !["localhost","127.0.0.1","[::1]"].includes(url.hostname) || url.pathname !== "/kedu_rehearsal" || url.search)
    throw Error("Use um PostgreSQL local com banco kedu_rehearsal.");
  const schema = "kedu_concurrency_" + randomBytes(8).toString("hex");
  const setup = postgres(url.toString(), {max:1});
  const sql = postgres(url.toString(), {max:2,connection:{search_path:schema}});
  try {
    await setup.begin(async tx => {
      await tx`CREATE SCHEMA ${tx(schema)}`;
      await tx.unsafe(`SET LOCAL search_path TO ${schema}`);
      await tx.unsafe(`
        CREATE TABLE contracts(id TEXT PRIMARY KEY,school_id TEXT NOT NULL,parent_id TEXT REFERENCES contracts(id),
          sequence BIGINT,status TEXT NOT NULL DEFAULT 'Em preparação',UNIQUE(parent_id,sequence));
        CREATE VIEW contract_registry AS SELECT *,CASE WHEN parent_id IS NULL THEN 'Matriz' ELSE 'Aditivo' END AS instrument_kind FROM contracts;
        CREATE TABLE signed_history(matrix_id TEXT REFERENCES contracts(id),sequence BIGINT,source TEXT,PRIMARY KEY(matrix_id,sequence));
        CREATE TABLE history_confirmations(id TEXT PRIMARY KEY,matrix_id TEXT,sequence BIGINT);
        CREATE TABLE reading_jobs(demand_id TEXT,ticket_hash TEXT,state TEXT,attempts BIGINT DEFAULT 0,
          available_at BIGINT,updated BIGINT,owner TEXT,last_error TEXT DEFAULT '',progress BIGINT DEFAULT 0,
          PRIMARY KEY(demand_id,ticket_hash));
        INSERT INTO contracts(id,school_id,status) VALUES('matrix','school','Assinado');
        INSERT INTO signed_history VALUES('matrix',3,'Clicksign');
      `);
    });
    const attempts = await Promise.allSettled([
      sql.begin(tx => allocatePostgresAddendum(tx,"school","matrix")),
      sql.begin(tx => allocatePostgresAddendum(tx,"school","matrix")),
    ]);
    const won = attempts.filter(result => result.status === "fulfilled");
    const lost = attempts.filter(result => result.status === "rejected");
    assert.equal(won.length,1);
    assert.equal(won[0].value.sequence,4);
    assert.equal(lost.length,1);
    assert.equal(lost[0].reason.status,409);
    const [reserved] = await sql`SELECT count(*) AS n FROM contracts WHERE parent_id='matrix'`;
    assert.equal(Number(reserved.n),1);
    let now = 1000;
    const first = new PostgresReadingQueue(sql,()=>now);
    const second = new PostgresReadingQueue(sql,()=>now);
    await first.enqueue("a","v1");
    await first.enqueue("a","v2");
    await first.enqueue("b","v1");
    const claims = await Promise.all([first.claim(),second.claim()]);
    assert.equal(claims.filter(Boolean).length,1);
    const job = claims[0] ?? claims[1]!;
    assert.equal(job.ticket_hash,"v2");
    const [owner, outsider] = claims[0] ? [first,second] : [second,first];
    assert.equal(await outsider.finish(job,"done"),false);
    assert.equal(await owner.finish(job,"retry","Leitor temporariamente indisponível",0,true),true);
    const next = await outsider.claim();
    assert.equal(next?.demand_id,"b");
    assert.equal(await outsider.finish(next!,"done"),true);
    assert.equal(await owner.claim(),undefined);
    now += 600000;
    const retry = await owner.claim();
    assert.equal(retry?.demand_id,"a");
    assert.equal(retry?.attempts,1);
    assert.equal(await owner.finish(retry!,"done"),true);
    console.log("Concorrência PostgreSQL validada: uma reserva e uma leitura ativa por vez.");
  } finally {
    await sql.end({timeout:3});
    try { await setup`DROP SCHEMA IF EXISTS ${setup(schema)} CASCADE`; }
    finally { await setup.end({timeout:3}); }
  }
}

main().catch(error=>{
  const location = String(error?.stack).match(/postgres-concurrency-check\.ts:\d+:\d+/)?.[0];
  console.error("Falha no ensaio de concorrência.",error?.code || "",location || "");
  process.exitCode=1;
});
