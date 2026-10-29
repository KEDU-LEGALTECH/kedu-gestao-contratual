import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readNativePdf} from '../server/file-reading-engine.js';
function pdf(pages:number){
 const content='BT /F1 12 Tf 20 700 Td (CNPJ: 11.444.777/0001-61) Tj 0 -20 Td (Razao social: Escola de teste da leitura digital) Tj ET';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Count ${pages} /Kids [${Array.from({length:pages},(_,i)=>`${i+3} 0 R`).join(' ')}] >>`,...Array.from({length:pages},()=>`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 ${pages+4} 0 R >> >> /Contents ${pages+3} 0 R >>`),`<< /Length ${content.length} >>\nstream\n${content}\nendstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 let text='%PDF-1.4\n';const offsets=[0];for(const [i,o] of objects.entries()){offsets.push(text.length);text+=`${i+1} 0 obj\n${o}\nendobj\n`;}const start=text.length;text+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;return Buffer.from(text);
}
test('PDF digital de 40 páginas é inspecionado integralmente, sem descartar as páginas após 30',async()=>{
 const r=await readNativePdf(pdf(40));assert.equal(r.pages,40);assert.equal(r.incomplete,false);
 assert.deepEqual(r.completedPages,Array.from({length:40},(_,i)=>i+1));assert.deepEqual(r.pendingPages,[]);
 assert.ok(r.fields.cnpj.includes('11.444.777/0001-61'));
});
