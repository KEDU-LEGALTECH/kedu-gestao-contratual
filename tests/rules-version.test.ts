import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { changedFiles, currentTag, readRecord } from "../scripts/rules-version.js";

test("regra de conferência alterada exige nova etiqueta em fingerprint()", () => {
  const record = readRecord();
  assert.equal(currentTag(), record.tag,
    "A etiqueta de fingerprint() mudou: rode npm run rules:record para registrar os arquivos com a nova etiqueta.");
  for (const path of Object.keys(record.files)) assert.ok(existsSync(path), "Arquivo de regra não encontrado: " + path);
  const changed = changedFiles(record);
  assert.deepEqual(changed, [],
    "Arquivos de regra alterados: " + changed.join(", ") + ". Troque a etiqueta em fingerprint() de " +
    "server/contract-processing.ts e rode npm run rules:record (ou npm run rules:record -- --same-tag se nenhuma conferência muda).");
});
