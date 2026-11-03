import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recoverDigitalOriginal} from '../server/digital-recovery.js';
import {readingPdf,mixedReadingPdf} from './reading-fixtures.js';

test('native PDF recovery preserves page and quote without OCR or reference values',async()=>{
 const r=await recoverDigitalOriginal(readingPdf(),'documento.pdf');
 assert.deepEqual(r.fields.cnpj,['11.444.777/0001-61']);
 assert.equal(r.fieldOrigins.cnpj[0].page,1);
 assert.match(r.fieldOrigins.cnpj[0].excerpt,/11\.444\.777\/0001-61/);
});
test('native recovery keeps scanned pages pending and recovers later digital pages',async()=>{
 const r=await recoverDigitalOriginal(mixedReadingPdf(),'misto.pdf');
 assert.equal(r.pages,2);assert.ok(r.pendingPages.includes(1));
 assert.deepEqual(r.fields.cnpj,['00.817.900/0001-26']);
 assert.equal(r.fieldOrigins.cnpj[0].page,2);
});
