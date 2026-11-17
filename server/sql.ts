import { AsyncLocalStorage } from "node:async_hooks";
import type { DatabaseSync } from "node:sqlite";
import type postgres from "postgres";

export type Row = Record<string, any>;
export type RunResult = { changes: number };
/** Async data access shared by the SQLite runtime and the PostgreSQL migration target. */
export interface Sql {
  readonly dialect: "sqlite" | "postgres";
  close?(): Promise<void>;
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
  const source = query
    // A value selected directly keeps its JSON type (numbers stay numbers, as in SQLite).
    .replace(/\bjson_extract\(\s*([\w.]+)\s*,\s*'\$\.(\w+)'\s*\)(\s+AS\b)/gi, "(($1)::jsonb -> '$2')$3")
    .replace(/\bjson_extract\(\s*([\w.]+)\s*,\s*'\$\.(\w+)'\s*\)/gi, "(($1)::jsonb ->> '$2')")
    .replace(/\bjson_array_length\(\s*([\w.]+)\s*,\s*'\$\.(\w+)'\s*\)/gi, "jsonb_array_length(($1)::jsonb -> '$2')")
    .replace(/\bjson_remove\(\s*([\w.]+)\s*,\s*'\$\.(\w+)'\s*\)/gi, "((($1)::jsonb) - '$2')::text")
    // json_set stores a parameter or literal as a JSON string, and json(?) as parsed JSON.
    .replace(/\bjson_set\(\s*([\w.]+)\s*,\s*'\$\.(\w+)'\s*,\s*(json\(\?\)|\?|'(?:[^']|'')*')\s*\)/gi, (_, target: string, key: string, value: string) =>
      `jsonb_set((${target})::jsonb,'{${key}}',${/^json/i.test(value) ? "((?)::text)::jsonb" : `to_jsonb((${value})::text)`})::text`);
  let result = source.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"|[^'"]+/g, part => {
    if (part[0] === "'" || part[0] === '"') return part;
    return part
      .replace(/\?/g, () => "$" + ++n)
      // Two-argument max/min are scalar in SQLite; the one-argument aggregates are left alone.
      .replace(/\b(max|min)\(([^(),]+),([^(),]+)\)/gi, (_, fn: string, x: string, y: string) => (fn.toLowerCase() === "max" ? "greatest(" : "least(") + x + "," + y + ")")
      .replace(/\browid\b/gi, "_rowid")
      // PostgreSQL folds unquoted names to lowercase; camelCase aliases must keep their case.
      .replace(/\bAS\s+([a-z_]\w*[A-Z]\w*)\b/g, 'AS "$1"')
      .replace(/\)\s+([a-z]\w*[A-Z]\w*)(?=\s*(?:,|FROM\b))/g, ') "$1"')
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

/** Integer, numeric and boolean results come back as JavaScript numbers, as they do from SQLite. */
export const postgresTypes = {
  bigint: { to: 20, from: [20], parse: Number, serialize: String },
  numeric: { to: 0, from: [1700], parse: Number, serialize: String },
  // SQLite has no booleans: comparisons and EXISTS return 1 or 0.
  boolean: { to: 16, from: [16], parse: (value: string) => (value === "t" ? 1 : 0), serialize: (value: unknown) => (value ? "t" : "f") },
};

type ReadCache = { entries: Map<string, Promise<Row[]>>; open: boolean };
/** Reads repeated within one request (same SQL and parameters) reach the remote database once.
 * Any write clears it; transactions and work outliving the request bypass it. */
export const readCache = new AsyncLocalStorage<ReadCache>();
export const withReadCache = <T>(work: () => T, store: ReadCache = { entries: new Map(), open: true }) => readCache.run(store, work);

export function postgresSql(pool: postgres.Sql): Sql {
  const scope = new AsyncLocalStorage<postgres.TransactionSql>();
  // Named statements skip the parameter description round trip after the first use on a connection.
  const exec = (query: string, params: unknown[]) =>
    (scope.getStore() ?? pool).unsafe(toPostgres(query), params as any[], { prepare: true });
  // `SELECT *` would expose the imported insertion order column, which SQLite rows never carry.
  // It stays only when the select list names rowid; ORDER BY rowid alone does not return it.
  const fetchRows = async (query: string, params: unknown[]) => {
    const result = [...await exec(query, params)] as Row[];
    const selectList = query.slice(0, Math.max(0, query.search(/\bFROM\b/i)));
    if (!/\browid\b/i.test(selectList)) for (const row of result) delete row._rowid;
    return result;
  };
  const rows = async (query: string, params: unknown[]) => {
    const cache = readCache.getStore();
    if (!cache?.open || scope.getStore() || !/^\s*SELECT\b/i.test(query)) return fetchRows(query, params);
    const key = query + "\u0000" + JSON.stringify(params);
    let pending = cache.entries.get(key);
    if (!pending) {
      pending = fetchRows(query, params);
      cache.entries.set(key, pending);
      pending.catch(() => cache.entries.delete(key));
    }
    // Callers may change the rows they receive; each one gets its own copies.
    return (await pending).map(row => ({ ...row }));
  };
  const written = () => readCache.getStore()?.entries.clear();
  return {
    dialect: "postgres",
    close: () => pool.end({ timeout: 5 }),
    async all(query, ...params) { return rows(query, params); },
    async one(query, ...params) { return (await rows(query, params))[0]; },
    async run(query, ...params) { written(); try { return { changes: (await exec(query, params)).count }; } finally { written(); } },
    async transaction(work) {
      if (scope.getStore()) return work();
      written();
      try { return await pool.begin(tx => scope.run(tx, work)) as any; } finally { written(); }
    },
  };
}
