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


test("identificação inconclusiva pede a leitura completa; foto lida por inteiro e áudio viram apoio", () => {
  const triage = cached({ triageOnly: true, text: "Foto da fachada da escola", method: "Identificação inicial" });
  assert.equal(contractReadingScope("photo_2026-11-18.jpg", triage).needsWork, true);
  const full = cached({ text: "Comprovante de inscrição municipal da escola COC Bilíngue, emitido em 2026, situação ativa.", method: "OCR de imagem" });
  assert.deepEqual(contractReadingScope("photo_2026-11-18.jpg", full), { kind: "support", needsWork: false });
  assert.deepEqual(contractReadingScope("WhatsApp Ptt 2026-10-14 at 10.09.33.ogg", cached({ triageOnly: true, text: "" })), { kind: "support", needsWork: false });
});
