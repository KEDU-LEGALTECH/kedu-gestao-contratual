import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { sql } from "./db.js";
import { storagePath } from "./object-path.js";
import { supabaseConfig } from "./supabase-config.js";

/** Attachments read from tickets. SQLite keeps them in processing_files.bytes. On PostgreSQL that column
 * stays empty and the bytes live in object storage under their SHA-256, with bytes_sha256, bytes_size and
 * bytes_head (first 24 bytes) on the row. Rows still holding inline bytes are read as before. */
const external = () => sql.dialect === "postgres";
export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** SQL expressions for the stored size and first bytes, valid for both layouts. */
export const byteSizeSql = () => external() ? "(bytes_size+length(bytes))" : "length(bytes)";
export const byteHeadSql = () => external() ? "CASE WHEN length(bytes)>0 THEN substr(bytes,1,24) ELSE bytes_head END" : "substr(bytes,1,24)";

type StoredRow = { bytes?: Uint8Array | null; bytes_sha256?: string | null; bytes_size?: number | null };
export const storedSize = (row: StoredRow | null | undefined) => row?.bytes?.length || Number(row?.bytes_size || 0);
/** SHA-256 of the stored bytes without downloading them from storage. */
export const storedHash = (row: StoredRow | null | undefined) => row?.bytes?.length ? sha256(row.bytes) : row?.bytes_sha256 || sha256(Buffer.alloc(0));

interface ObjectStore { put(hash: string, bytes: Buffer): Promise<void>; get(hash: string): Promise<Buffer>; }
/** KEDU_FILE_STORE_DIR keeps objects in a local folder (tests); otherwise the private Supabase bucket. */
function objectStore(env = process.env): ObjectStore {
  if (env.KEDU_FILE_STORE_DIR) {
    const path = (hash: string) => join(env.KEDU_FILE_STORE_DIR!, storagePath(hash));
    return {
      async put(hash, bytes) { await mkdir(dirname(path(hash)), { recursive: true }); await writeFile(path(hash), bytes); },
      get: hash => readFile(path(hash)),
    };
  }
  const config = supabaseConfig(env);
  if (!config.key) throw Error("Configure SUPABASE_SECRET_KEY para ler e gravar anexos no Storage.");
  const headers = { apikey: config.key, Authorization: "Bearer " + config.key };
  const url = (hash: string, scope = "") => `${config.project}/storage/v1/object/${scope}${config.bucket}/${storagePath(hash)}`;
  return {
    async put(hash, bytes) {
      const response = await fetch(url(hash), { method: "POST", headers: { ...headers, "Content-Type": "application/octet-stream", "x-upsert": "false" }, body: new Uint8Array(bytes), signal: AbortSignal.timeout(120000) });
      // The path is the content hash, so an existing object already holds these bytes.
      if (!response.ok && !(response.status === 409 || /exists|duplicate/i.test(await response.text())))
        throw Error(`Não foi possível guardar o anexo no Storage (HTTP ${response.status}).`);
    },
    async get(hash) {
      const response = await fetch(url(hash, "authenticated/"), { headers, signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw Object.assign(Error(`Anexo indisponível no Storage (HTTP ${response.status}).`), { status: 503 });
      return Buffer.from(await response.arrayBuffer());
    },
  };
}

/** Bytes of a processing_files row, verified against the recorded hash when they come from storage. */
export async function fileBytes(row: StoredRow | null | undefined): Promise<Buffer> {
  if (row?.bytes?.length) return Buffer.from(row.bytes);
  if (!row?.bytes_sha256 || !row.bytes_size) return Buffer.alloc(0);
  const bytes = await objectStore().get(row.bytes_sha256);
  if (bytes.length !== Number(row.bytes_size) || sha256(bytes) !== row.bytes_sha256)
    throw Object.assign(Error("O anexo guardado não confere com o registro. Baixe o original novamente."), { status: 503 });
  return bytes;
}

type ProcessingFile = { id: string; demand_id: string; document_id: string; ticket_hash: string; name: string; mime: string; bytes: Buffer; extracted: string; problem: string; created: string };
/** Inserts a processing file; upsert replaces the same document of the same ticket version. */
export async function saveProcessingFile(file: ProcessingFile, upsert = false) {
  const columns = ["id", "demand_id", "document_id", "ticket_hash", "name", "mime", "bytes", "extracted", "problem", "created"];
  const values: unknown[] = [file.id, file.demand_id, file.document_id, file.ticket_hash, file.name, file.mime, file.bytes, file.extracted, file.problem, file.created];
  if (external()) {
    const hash = file.bytes.length ? sha256(file.bytes) : null;
    if (hash) await objectStore().put(hash, file.bytes);
    values[6] = Buffer.alloc(0);
    columns.push("bytes_sha256", "bytes_size", "bytes_head");
    values.push(hash, file.bytes.length, file.bytes.subarray(0, 24));
  }
  const keys = ["id", "demand_id", "document_id", "ticket_hash"];
  const update = upsert ? " ON CONFLICT(demand_id,document_id,ticket_hash) DO UPDATE SET " + columns.filter(c => !keys.includes(c)).map(c => `${c}=excluded.${c}`).join(",") : "";
  await sql.run(`INSERT INTO processing_files(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})${update}`, ...values);
}
