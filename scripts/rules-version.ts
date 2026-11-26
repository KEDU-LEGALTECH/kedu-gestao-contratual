// Records the conferência rule files next to the version tag of fingerprint() (server/contract-processing.ts).
// tests/rules-version.test.ts fails when one of them changes without this record, so a rule change cannot
// reach production with the old tag: open demands would keep the status computed by the previous rules.
// Usage: npm run rules:record            (after changing the tag)
//        npm run rules:record -- --same-tag   (the change does not alter any conferência result)
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const recordPath = "server/rules-version.json";
type RulesRecord = { tag: string; files: Record<string, string> };

export const currentTag = () =>
  /JSON\.stringify\(\['([^']+)'/.exec(readFileSync("server/contract-processing.ts", "utf8"))?.[1] ?? "";
// Line endings differ between Windows and Linux checkouts.
const fileHash = (path: string) => createHash("sha256").update(readFileSync(path, "utf8").replace(/\r\n/g, "\n")).digest("hex");
export const readRecord = () => JSON.parse(readFileSync(recordPath, "utf8")) as RulesRecord;
export const changedFiles = (record = readRecord()) => Object.keys(record.files).filter((path) => fileHash(path) !== record.files[path]);

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const record = readRecord(), tag = currentTag(), changed = changedFiles(record);
  if (changed.length && tag === record.tag && !process.argv.includes("--same-tag")) {
    console.error(`Arquivos de regra alterados com a mesma etiqueta (${tag}):\n  ${changed.join("\n  ")}\n` +
      "Troque a etiqueta em fingerprint() de server/contract-processing.ts, ou use --same-tag se nenhuma conferência muda.");
    process.exit(1);
  }
  const files = Object.fromEntries(Object.keys(record.files).sort().map((path) => [path, fileHash(path)]));
  writeFileSync(recordPath, JSON.stringify({ tag, files }, null, 2) + "\n");
  console.log(`Registro atualizado: etiqueta ${tag}, ${Object.keys(files).length} arquivos.`);
}
