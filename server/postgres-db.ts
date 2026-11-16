import postgres from "postgres";
import { supabaseConfig } from "./supabase-config.js";
import { postgresSql, postgresTypes } from "./sql.js";

/** KEDU_PG_URL selects a local PostgreSQL (tests); otherwise the Supabase connection is used. */
function target(env: NodeJS.ProcessEnv) {
  if (!env.KEDU_PG_URL) {
    const config = supabaseConfig(env);
    return { connection: config.connection, ssl: config.ssl as postgres.Options<{}>["ssl"] };
  }
  const url = new URL(env.KEDU_PG_URL);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw Error("KEDU_PG_URL aceita apenas PostgreSQL local.");
  return { connection: url.toString(), ssl: false as const };
}

/** Connects to the schema named by KEDU_PG_SCHEMA. The schema is created by the importer;
 * this never creates or migrates tables. */
export async function openPostgres(env: NodeJS.ProcessEnv = process.env) {
  const schema = env.KEDU_PG_SCHEMA || "kedu";
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) throw Error("KEDU_PG_SCHEMA inválido.");
  const { connection, ssl } = target(env);
  const pool = postgres(connection, {
    // The Session pooler has a fixed client limit shared by every instance: Vercel runs several, so each keeps fewer.
    ssl, max: Number(env.KEDU_PG_POOL || (env.VERCEL ? 3 : 5)), connect_timeout: 10, idle_timeout: env.VERCEL ? 20 : 60,
    types: postgresTypes, connection: { search_path: schema }, onnotice: () => {},
  });
  const [ready] = await pool`SELECT to_regclass('demands') IS NOT NULL AS ok`;
  if (!ready.ok) {
    await pool.end({ timeout: 2 });
    throw Error(`Esquema ${schema} sem as tabelas do portal. Importe os dados antes de usar KEDU_DATABASE=postgres.`);
  }
  return postgresSql(pool);
}
