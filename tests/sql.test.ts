import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { sqliteSql, toPostgres } from "../server/sql.js";

test("tradução para PostgreSQL preserva literais e converte o dialeto do portal", () => {
  assert.equal(toPostgres("SELECT * FROM t WHERE a=? AND b='?' AND c=? ORDER BY rowid DESC"),
    "SELECT * FROM t WHERE a=$1 AND b='?' AND c=$2 ORDER BY _rowid DESC");
  assert.equal(toPostgres("INSERT OR IGNORE INTO t VALUES(?,?)"), "INSERT INTO t VALUES($1,$2) ON CONFLICT DO NOTHING");
  assert.equal(toPostgres("INSERT OR IGNORE INTO t(a) VALUES(?) RETURNING a;"), "INSERT INTO t(a) VALUES($1) ON CONFLICT DO NOTHING RETURNING a");
  assert.equal(toPostgres("SELECT 1 WHERE a LIKE ? AND b NOT LIKE '%LIKE%'"), "SELECT 1 WHERE a ILIKE $1 AND b NOT ILIKE '%LIKE%'");
  assert.equal(toPostgres("SELECT json_extract(d.data,'$.matriz') AS m"), "SELECT ((d.data)::jsonb -> 'matriz') AS m");
  assert.equal(toPostgres("SELECT status,json_extract(payload,'$.priority') AS priority FROM t WHERE json_array_length(payload, '$.documents') > 0"),
    "SELECT status,((payload)::jsonb -> 'priority') AS priority FROM t WHERE jsonb_array_length((payload)::jsonb -> 'documents') > 0");
  assert.equal(toPostgres("UPDATE t SET payload=json_set(payload,'$.content',?),a=json_set(a,'$.priority','5'),b=json_set(b,'$.origins',json(?)) WHERE id=?"),
    "UPDATE t SET payload=jsonb_set((payload)::jsonb,'{content}',to_jsonb(($1)::text))::text,a=jsonb_set((a)::jsonb,'{priority}',to_jsonb(('5')::text))::text,b=jsonb_set((b)::jsonb,'{origins}',(($2)::text)::jsonb)::text WHERE id=$3");
  assert.equal(toPostgres("SELECT length(bytes) AS byteLength,length(bytes) byteSize FROM t"),
    `SELECT length(bytes) AS "byteLength",length(bytes) "byteSize" FROM t`);
  assert.equal(toPostgres("UPDATE t SET extracted=json_remove(extracted,'$.verifiedFields')"),
    "UPDATE t SET extracted=(((extracted)::jsonb) - 'verifiedFields')::text");
  assert.equal(toPostgres(`SELECT "rowid" FROM t`), `SELECT "rowid" FROM t`);
  assert.equal(toPostgres("UPDATE t SET a=max(0,a-1),b=max(b,?) WHERE c=(SELECT max(c) FROM t)"),
    "UPDATE t SET a=greatest(0,a-1),b=greatest(b,$1) WHERE c=(SELECT max(c) FROM t)");
  assert.throws(() => toPostgres("INSERT OR REPLACE INTO t VALUES(?)"), /conflito explícito/);
});

test("transação SQLite isola consultas concorrentes e desfaz em caso de erro", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT)");
  const sql = sqliteSql(db);
  let release!: () => void;
  const paused = new Promise<void>(resolve => { release = resolve; });
  const tx = sql.transaction(async () => {
    await sql.run("INSERT INTO t(v) VALUES(?)", "dentro");
    await paused;
    await sql.transaction(() => sql.run("INSERT INTO t(v) VALUES(?)", "aninhada"));
  });
  const outside = sql.all("SELECT v FROM t ORDER BY id");
  const second = sql.transaction(() => sql.run("INSERT INTO t(v) VALUES(?)", "segunda"));
  release();
  assert.deepEqual((await outside).map(r => r.v), ["dentro", "aninhada", "segunda"]);
  await Promise.all([tx, second]);
  await assert.rejects(sql.transaction(async () => {
    await sql.run("INSERT INTO t(v) VALUES(?)", "desfeita");
    throw Error("falha");
  }), /falha/);
  assert.deepEqual((await sql.all("SELECT v FROM t ORDER BY id")).map(r => r.v), ["dentro", "aninhada", "segunda"]);
  assert.deepEqual(await sql.run("UPDATE t SET v=v"), { changes: 3 });
});
