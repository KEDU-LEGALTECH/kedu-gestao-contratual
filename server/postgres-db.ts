import postgres from "postgres";
import { supabaseConfig } from "./supabase-config.js";
import { postgresSql, postgresTypes } from "./sql.js";

/** Connects to the Supabase schema named by KEDU_PG_SCHEMA. The schema is created by the importer;
 * this never creates or migrates tables. */
export async function openPostgres(env: NodeJS.ProcessEnv = process.env) {
  const schema = env.KEDU_PG_SCHEMA || "kedu";
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) throw Error("KEDU_PG_SCHEMA inválido.");
  const config = supabaseConfig(env);
  const pool = postgres(config.connection, {
    ssl: config.ssl, max: Number(env.KEDU_PG_POOL || 5), connect_timeout: 10, idle_timeout: 60,
    types: postgresTypes, connection: { search_path: schema }, onnotice: () => {},
  });
  const [ready] = await pool`SELECT to_regclass('demands') IS NOT NULL AS ok`;
  if (!ready.ok) {
    await pool.end({ timeout: 2 });
    throw Error(`Esquema ${schema} sem as tabelas do portal. Importe os dados antes de usar KEDU_DATABASE=postgres.`);
  }
  return postgresSql(pool);
}
