import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { contentType, storagePath } from "../server/object-path.js";
import { supabaseConfig } from "../server/supabase-config.js";

type ManifestObject = { table: string; column: string; key: Record<string, string>; sha256: string; size: number; object: string };
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

async function pool<T>(items: T[], size: number, task: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => { while (next < items.length) await task(items[next++]); }));
}

async function main() {
  const [folder, option] = process.argv.slice(2);
  // --refresh-large rewrites objects above 4 MB so Storage serves them with their type (they leave through links).
  const refreshLarge = option === "--refresh-large";
  if (!folder) throw Error("Informe a pasta do manifesto da migração.");
  const root = resolve(folder);
  const c = supabaseConfig();
  if (!c.key) throw Error("Configure SUPABASE_SECRET_KEY no .env do servidor.");
  const headers = { apikey: c.key, Authorization: "Bearer " + c.key };
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  const unique = new Map<string, ManifestObject>();
  for (const object of manifest.objects as ManifestObject[]) unique.set(object.sha256, object);
  const objects = [...unique.values()];
  const url = (hash: string) => c.project + "/storage/v1/object/" + c.bucket + "/" + storagePath(hash);
  let sent = 0, existing = 0, verified = 0;

  await pool(objects, 6, async object => {
    const bytes = await readFile(join(root, object.object));
    if (bytes.length !== object.size || sha256(bytes) !== object.sha256) throw Error("Objeto local diverge do manifesto: " + object.sha256);
    const response = await fetch(url(object.sha256), {
      method: "POST", headers: { ...headers, "Content-Type": contentType(bytes), "x-upsert": refreshLarge && bytes.length > 4 * 1024 * 1024 ? "true" : "false" },
      body: bytes, signal: AbortSignal.timeout(120000),
    });
    if (response.ok) sent++;
    else if (response.status === 409 || (response.status === 400 && /exists/i.test(await response.text()))) existing++;
    else throw Error(`Falha ao enviar ${object.sha256} (HTTP ${response.status}).`);
  });

  // Download every object back and compare size and hash with the manifest.
  await pool(objects, 6, async object => {
    const response = await fetch(c.project + "/storage/v1/object/authenticated/" + c.bucket + "/" + storagePath(object.sha256),
      { headers, signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw Error(`Falha ao baixar ${object.sha256} (HTTP ${response.status}).`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== object.size || sha256(bytes) !== object.sha256) throw Error("Hash divergente no Storage: " + object.sha256);
    verified++;
  });
  console.log(JSON.stringify({ arquivosUnicos: objects.length, enviados: sent, jaExistiam: existing, conferidos: verified,
    megabytes: +(objects.reduce((sum, o) => sum + o.size, 0) / 1048576).toFixed(1) }));
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
