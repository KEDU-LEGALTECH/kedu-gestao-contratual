import { test, after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "kedu-serverless-")), "test.sqlite");
process.env.NODE_ENV = "test";
process.env.DEMO_SEED = "false";
process.env.CRON_SECRET = "segredo-de-teste-do-cron";
// Never reach the real GLPI from tests: demonstration source and no daily slots.
process.env.GLPI_MODE = "demo";
process.env.GLPI_SYNC_TIMES = "";
const { default: app } = await import("../server/index.js");
const { sql } = await import("../server/db.js");
const { ReadingJobQueue } = await import("../server/reading-job-queue.js");

const server = app.listen(0, "127.0.0.1");
await new Promise(resolve => server.on("listening", resolve));
after(() => server.close());
const base = `http://127.0.0.1:${(server.address() as any).port}`;

test("instâncias sobrepostas só retomam leitura parada há mais tempo que qualquer execução", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync("migrations/017.sql", "utf8"));
  db.exec(readFileSync("migrations/018.sql", "utf8"));
  try {
    let time = 1000;
    const first = new ReadingJobQueue(db, () => time, 60000);
    await first.enqueue("a", "hash");
    const job = (await first.claim())!;
    assert.equal(job.demand_id, "a");
    // Another instance starts while the first one is still reading.
    time += 30000;
    const second = new ReadingJobQueue(db, () => time, 60000);
    assert.equal(await second.claim(), undefined, "leitura em andamento não é tomada por outra instância");
    // The first instance was stopped without finishing: after the threshold the job resumes.
    time += 31000;
    await second.recoverStale();
    const resumed = (await second.claim())!;
    assert.equal(resumed.demand_id, "a");
    assert.equal(resumed.attempts, 1, "a retomada não consome tentativa");
  } finally { db.close(); }
});

test("leitor de OCR no GitHub Actions só pega demandas com arquivo aguardando OCR", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE processing_files(id TEXT,demand_id TEXT,ticket_hash TEXT,extracted TEXT)");
  db.exec(readFileSync("migrations/017.sql", "utf8"));
  db.exec(readFileSync("migrations/018.sql", "utf8"));
  try {
    db.prepare("INSERT INTO processing_files VALUES('f1','digital','h',?)").run(JSON.stringify({ text: "Contrato" }));
    db.prepare("INSERT INTO processing_files VALUES('f2','escaneado','h',?)").run(JSON.stringify({ awaitingOcr: true }));
    const queue = new ReadingJobQueue(db, () => 1000, 60000);
    await queue.enqueue("digital", "h");
    await queue.enqueue("escaneado", "h");
    assert.equal((await queue.claim(true))?.demand_id, "escaneado");
    assert.equal(await queue.claim(true), undefined, "uma leitura por vez, e nunca a demanda só com digitais");
  } finally { db.close(); }
});

test("rotas do Vercel Cron exigem o segredo e respeitam a pausa da leitura", async () => {
  const call = (path: string, authorization?: string) =>
    fetch(base + path, { headers: authorization ? { Authorization: authorization } : {} });
  for (const path of ["/api/cron/reading", "/api/cron/glpi-sync"]) {
    assert.equal((await call(path)).status, 401);
    assert.equal((await call(path, "Bearer outro-segredo")).status, 401);
  }
  await sql.run("INSERT INTO settings(key,value) VALUES('documentReadingPaused','true') ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  const reading = await call("/api/cron/reading", "Bearer segredo-de-teste-do-cron");
  assert.equal(reading.status, 200);
  assert.deepEqual(await reading.json(), { paused: true });
  // Without configured daily times there is no slot to run.
  const sync = await call("/api/cron/glpi-sync", "Bearer segredo-de-teste-do-cron");
  assert.equal(sync.status, 200);
  assert.deepEqual(await sync.json(), { synced: false, reason: "no_times" });
});

test("API hospedada sem PaddleOCR lê só arquivos digitais e deixa imagens e escaneados aguardando OCR", async () => {
  const { readerAvailable } = await import("../server/paddle-ocr.js");
  const { readProcessingFile } = await import("../server/file-reading.js");
  const { preservePreviousReading } = await import("../server/reading-recovery-policy.js");
  const { readingPdf, mixedReadingPdf, readingImage } = await import("./reading-fixtures.js");
  const previous = process.env.KEDU_ROLE;
  try {
    assert.equal(readerAvailable(), true, "fora da hospedagem o leitor segue como hoje");
    process.env.KEDU_ROLE = "api";
    assert.equal(readerAvailable(), false);
    const digital = await readProcessingFile(readingPdf(), "contrato.pdf");
    assert.equal(digital.problem, "");
    assert.equal(digital.method, "Texto do PDF");
    assert.equal(digital.awaitingOcr, undefined);
    assert.deepEqual(digital.fields.cnpj, ["11.444.777/0001-61"]);
    // Never Tesseract alone: a scanned page anywhere keeps the whole file for the OCR reader.
    for (const [bytes, name] of [[readingPdf(true), "escaneado.pdf"], [mixedReadingPdf(), "misto.pdf"], [readingImage().toBuffer("image/png"), "foto.png"]] as const) {
      const waiting = await readProcessingFile(bytes, name);
      assert.equal(waiting.awaitingOcr, true, name);
      assert.match(waiting.problem, /Aguardando leitura com OCR/);
      assert.equal(waiting.text, "", name);
    }
    const { default: PizZip } = await import("pizzip");
    const { demoTemplate } = await import("../server/documents.js");
    const { createCanvas } = await import("@napi-rs/canvas");
    const word = (image: Buffer) => {
      const zip = new PizZip(demoTemplate());
      zip.file("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Razão social: Empresa teste</w:t></w:r></w:p></w:body></w:document>');
      zip.file("word/media/imagem.png", image);
      return zip.generate({ type: "nodebuffer" });
    };
    const withLogo = await readProcessingFile(word(createCanvas(120, 60).toBuffer("image/png")), "contrato.docx");
    assert.equal(withLogo.method, "DOCX", "logotipo pequeno não precisa de OCR, como no leitor completo");
    assert.deepEqual(withLogo.fields.razaoSocial, ["Empresa teste"]);
    assert.equal((await readProcessingFile(word(readingImage().toBuffer("image/png")), "digitalizado.docx")).awaitingOcr, true);
    const identification = await readProcessingFile(readingPdf(true), "anexo.pdf", { page: 1, x: 0, y: 0, width: 1, height: 1, rotation: 0, identification: true });
    assert.equal(identification.awaitingOcr, true, "identificação de PDF sem texto também espera o OCR");
    assert.equal(preservePreviousReading(JSON.stringify(digital), await readProcessingFile(readingPdf(true), "escaneado.pdf")), true, "leitura anterior que funcionou é preservada");
    await sql.run("UPDATE settings SET value='false' WHERE key='documentReadingPaused'");
    const reading = await fetch(base + "/api/cron/reading", { headers: { Authorization: "Bearer segredo-de-teste-do-cron" } });
    assert.deepEqual(await reading.json(), { paused: false, pending: 0 });
  } finally {
    if (previous === undefined) delete process.env.KEDU_ROLE; else process.env.KEDU_ROLE = previous;
  }
});
