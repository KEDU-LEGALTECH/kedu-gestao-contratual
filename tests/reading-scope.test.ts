import { test } from "node:test";
import assert from "node:assert/strict";
import { contractReadingScope } from "../server/contract-reading-scope.js";

const cached = (reading: object, problem = "") => ({ extracted: JSON.stringify(reading), problem, byteLength: 100 });

test("identificação inicial que falhou sem texto volta para a leitura completa", () => {
  const failed = cached({ triageOnly: true, text: "", method: "Identificação inicial" }, 'Setting up fake worker failed: "Cannot find module pdf.worker"');
  assert.equal(contractReadingScope("CTT 3255 - KEDU.pdf", failed).needsWork, true);
  assert.equal(contractReadingScope("Termo Anexo - Domus Maria.pdf", failed).needsWork, true);
  // A triage that read text and found no contract is finished.
  const read = cached({ triageOnly: true, text: "Notificação extrajudicial enviada à escola em 12/11.", method: "Identificação inicial" });
  assert.equal(contractReadingScope("notificacao.pdf", read).needsWork, false);
});

