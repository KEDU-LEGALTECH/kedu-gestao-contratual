import {test,after} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {readingImage} from "./reading-fixtures.js";

const folder=mkdtempSync(join(tmpdir(),"kedu-cache-"));
process.env.READING_CACHE_PATH=join(folder,"cache.sqlite");
const {readProcessingFile,cachedPdfPage,storePdfPage}=await import("../server/file-reading.js");

test("leitura repetida do mesmo original reutiliza o resultado sem guardar falhas",async()=>{
 const image=readingImage().toBuffer("image/png");
 const first=await readProcessingFile(image,"documento.png");
 assert.equal(first.problem,"");
 const second=await readProcessingFile(image,"documento.png");
 assert.deepEqual(second,first);
 const blank=await readProcessingFile(readingImage(true).toBuffer("image/png"),"branco.png");
 assert.notEqual(blank.problem,"");
 const db=new DatabaseSync(process.env.READING_CACHE_PATH!,{readOnly:true});
 try{assert.equal((db.prepare("SELECT count(*) n FROM readings").get() as any).n,1);}
 finally{db.close();}
});

after(()=>{try{rmSync(folder,{recursive:true,force:true});}catch{/* Windows keeps the open cache locked until exit. */}});

test("leitor permanece disponível para arquivos seguintes",async()=>{
 for(const name of ["a.png","b.png","c.png"]){
  const r=await readProcessingFile(readingImage().toBuffer("image/png"),name);
  assert.equal(r.problem,"");
 }
});
test('páginas completas podem ser retomadas; páginas parciais não entram no cache',()=>{
 const reading={version:3,text:'CNPJ: 11.444.777/0001-61',fields:{cnpj:['11.444.777/0001-61']},problem:'',method:'OCR de página PDF',needsReview:true};
 storePdfPage('original-test',1,reading);assert.deepEqual(cachedPdfPage('original-test',1),reading);
 storePdfPage('original-test',2,{...reading,incomplete:true});assert.equal(cachedPdfPage('original-test',2),undefined);
});
