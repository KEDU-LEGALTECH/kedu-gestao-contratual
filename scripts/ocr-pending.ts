// Counts current-version files awaiting OCR and writes it to the GitHub Actions output,
// so a run without pending files ends before installing PaddleOCR.
import { appendFileSync } from "node:fs";
import postgres from "postgres";
import { supabaseConfig } from "../server/supabase-config.js";

const schema = process.env.KEDU_PG_SCHEMA || "kedu";
if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) throw Error("KEDU_PG_SCHEMA inválido.");
const config = supabaseConfig(process.env);
const pg = postgres(config.connection, { ssl: config.ssl as any, max: 1, onnotice: () => {}, connection: { search_path: schema } });
try {
  const [{ n }] = await pg`SELECT count(*)::int AS n FROM processing_files f
    JOIN demands d ON d.id = f.demand_id
    JOIN glpi_tickets t ON t.external_id = d.glpi_id AND t.hash = f.ticket_hash
    WHERE f.extracted::jsonb->>'awaitingOcr' = 'true'`;
  console.log(`Arquivos aguardando OCR: ${n}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `pendentes=${n}\n`);
} finally {
  await pg.end({ timeout: 5 });
}
