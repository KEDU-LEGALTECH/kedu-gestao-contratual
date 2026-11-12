import { AsyncLocalStorage } from "node:async_hooks";
import type { DatabaseSync } from "node:sqlite";
import type postgres from "postgres";

export type Row = Record<string, any>;
export type RunResult = { changes: number };
/** Async data access shared by the SQLite runtime and the PostgreSQL migration target. */
export interface Sql {
  readonly dialect: "sqlite" | "postgres";
  all(query: string, ...params: unknown[]): Promise<any[]>;
  one(query: string, ...params: unknown[]): Promise<any>;
  run(query: string, ...params: unknown[]): Promise<RunResult>;
  /** Nested calls join the outer transaction. */
  transaction<T>(work: () => Promise<T>): Promise<T>;
}

/** SQLite has one connection: transactions are serialized and outside queries wait for them. */
export function sqliteSql(db: DatabaseSync): Sql {
  const scope = new AsyncLocalStorage<true>();
  let lock: Promise<void> = Promise.resolve();
  let pending = 0;
  const outside = async () => { while (!scope.getStore() && pending) await lock; };
  return {
    dialect: "sqlite",
    async all(query, ...params) { await outside(); return db.prepare(query).all(...params as any[]) as Row[]; },
    async one(query, ...params) { await outside(); return db.prepare(query).get(...params as any[]) as Row | undefined; },
    async run(query, ...params) { await outside(); return { changes: Number(db.prepare(query).run(...params as any[]).changes) }; },
    async transaction(work) {
      // Joins an outer transaction, including one opened directly with db.exec("BEGIN").
      if (scope.getStore() || db.isTransaction) return work();
      pending++;
      const previous = lock;
      let release!: () => void;
      lock = new Promise(resolve => { release = resolve; });
      await previous;
      try {
        return await scope.run(true, async () => {
          db.exec("BEGIN IMMEDIATE");
          try { const result = await work(); db.exec("COMMIT"); return result; }
          catch (error) { db.exec("ROLLBACK"); throw error; }
        });
      } finally { pending--; release(); }
    },
  };
}

const translated = new Map<string, string>();
/** Rewrites the SQLite dialect used by the portal. Literals and quoted identifiers are left untouched. */
export function toPostgres(query: string) {
  const cached = translated.get(query);
  if (cached) return cached;
  if (/\bINSERT\s+OR\s+REPLACE\b/i.test(query)) throw Error("INSERT OR REPLACE precisa de conflito explícito no PostgreSQL.");
  let n = 0, ignore = false;
  const source = query.replace(/\bjson_extract\(\s*([\w.]+)\s*,\s*'\$\.(\w+)'\s*\)/gi, "(($1)::jsonb ->> '$2')");
  let result = source.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"|[^'"]+/g, part => {
    if (part[0] === "'" || part[0] === '"') return part;
    return part
      .replace(/\?/g, () => "$" + ++n)
      // Two-argument max/min are scalar in SQLite; the one-argument aggregates are left alone.
      .replace(/\b(max|min)\(([^(),]+),([^(),]+)\)/gi, (_, fn: string, x: string, y: string) => (fn.toLowerCase() === "max" ? "greatest(" : "least(") + x + "," + y + ")")
      .replace(/\browid\b/gi, "_rowid")
      .replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, () => { ignore = true; return "INSERT INTO"; })
      .replace(/\bNOT\s+LIKE\b/gi, "NOT ILIKE")
      .replace(/(?<!NOT\s)\bLIKE\b/gi, "ILIKE");
  });
  if (ignore) {
    result = result.replace(/;\s*$/, "");
    if (/\bON\s+CONFLICT\b/i.test(result)) throw Error("INSERT OR IGNORE com ON CONFLICT não tem tradução.");
    const returning = /\bRETURNING\b/i.exec(result);
    result = returning
      ? result.slice(0, returning.index) + "ON CONFLICT DO NOTHING " + result.slice(returning.index)
      : result + " ON CONFLICT DO NOTHING";
  }
  translated.set(query, result);
  return result;
}

/** Integer and numeric results come back as JavaScript numbers, as they do from SQLite. */
export const postgresTypes = {
  bigint: { to: 20, from: [20], parse: Number, serialize: String },
  numeric: { to: 0, from: [1700], parse: Number, serialize: String },
};

export function postgresSql(pool: postgres.Sql): Sql {
  const scope = new AsyncLocalStorage<postgres.TransactionSql>();
  const exec = (query: string, params: unknown[]) =>
    (scope.getStore() ?? pool).unsafe(toPostgres(query), params as any[]);
  // `SELECT *` would expose the imported insertion order column, which SQLite rows never carry.
  const rows = async (query: string, params: unknown[]) => {
    const result = [...await exec(query, params)] as Row[];
    if (!/\browid\b/i.test(query)) for (const row of result) delete row._rowid;
    return result;
  };
  return {
    dialect: "postgres",
    async all(query, ...params) { return rows(query, params); },
    async one(query, ...params) { return (await rows(query, params))[0]; },
    async run(query, ...params) { return { changes: (await exec(query, params)).count }; },
    async transaction(work) {
      if (scope.getStore()) return work();
      return pool.begin(tx => scope.run(tx, work)) as Promise<any>;
    },
  };
}
