import assert from "node:assert/strict";
import sharp from "sharp";
import { readProcessingFile } from "../server/file-reading.js";
import { readingImage, readingPdf } from "../tests/reading-fixtures.js";

const png = readingImage().toBuffer("image/png");
const files: [string, Buffer][] = [
  ["contrato.png", png],
  ["contrato.jpeg", await sharp(png).jpeg().toBuffer()],
  ["contrato-escaneado.pdf", readingPdf(true, 2)],
];

for (const [name, bytes] of files) {
  const reading = await readProcessingFile(bytes, name);
  assert.equal(reading.problem, "", name);
  assert.match(reading.ocrEngine ?? "", /PaddleOCR/, name);
  assert.ok(reading.fields.cnpj?.includes("11.444.777/0001-61"), name);
  assert.ok(reading.fields.remuneracao?.includes("11,84%"), name);
  if (name.endsWith(".pdf")) {
    assert.deepEqual(reading.completedPages, [1, 2]);
    assert.deepEqual(reading.pendingPages, []);
  }
  console.log(`${name}: ${reading.ocrEngine}, campos esperados encontrados.`);
}
