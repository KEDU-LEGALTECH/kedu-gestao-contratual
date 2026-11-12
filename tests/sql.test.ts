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
  assert.equal(toPostgres("SELECT json_extract(d.data,'$.matriz') AS m"), "SELECT ((d.data)::jsonb ->> 'matriz') AS m");
  assert.equal(toPostgres(`SELECT "rowid" FROM t`), `SELECT "rowid" FROM t`);
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
