import { readFile } from 'node:fs/promises';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';

const filePath = process.argv[2];
const requested = process.argv.slice(3).map(Number).filter(Number.isInteger);
if (!filePath) throw new Error('Informe o caminho do PDF.');
const bytes = new Uint8Array(await readFile(filePath));
const require=createRequire(import.meta.url),root=dirname(require.resolve('pdfjs-dist/package.json'));
const task = getDocument({ data: bytes, verbosity: 0,standardFontDataUrl:join(root,'standard_fonts')+'/',cMapUrl:join(root,'cmaps')+'/',cMapPacked:true,wasmUrl:join(root,'wasm')+'/' });
try {
  const pdf = await task.promise;
  if (pdf.numPages > 500) throw new Error('PDF excede o limite de 500 páginas.');
  const pages = requested.length ? [...new Set(requested)] : Array.from({ length: Math.min(pdf.numPages, 6) }, (_, i) => i + 1);
  if (pages.length > 6 || pages.some(page => page < 1 || page > pdf.numPages)) throw new Error('Selecione de uma a seis páginas válidas.');
  const output = [];
  for (const pageNumber of pages) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const text = textContent.items.map(item => typeof item.str === 'string' ? item.str : '').filter(Boolean).join(' ');
    const viewport = page.getViewport({ scale: Math.min(1.6, 1800 / Math.max(page.view[2], page.view[3])) });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext('2d');
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    output.push({ page: pageNumber, text: text.slice(0, 30000), image: canvas.toBuffer('image/png').toString('base64') });
    page.cleanup();
  }
  process.stdout.write(JSON.stringify({ totalPages: pdf.numPages, pages: output }));
} finally {
  await task.destroy();
}
