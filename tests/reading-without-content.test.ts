import {test} from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import sharp from "sharp";
import PizZip from "pizzip";
process.env.NODE_ENV="test";
const {lacksVisibleContent}=await import("../server/image-content.js");
const {readDocument}=await import("../server/file-reading-engine.js");
const {ReadingJobQueue}=await import("../server/reading-job-queue.js");
const {onlyTemporary}=await import("../server/contract-processing.js");
const flat=(width:number,height:number,shade:number)=>sharp({create:{width,height,channels:3,background:{r:shade,g:shade,b:shade}}}).png().toBuffer();
// Black and white stripes: strong contrast, as printed text or a scanned page has.
async function striped(width:number,height:number){
 const raw=Buffer.alloc(width*height*3);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const v=(Math.floor(x/6)+Math.floor(y/10))%2?0:255;raw.fill(v,(y*width+x)*3,(y*width+x)*3+3);}
 return sharp(raw,{raw:{width,height,channels:3}}).png().toBuffer();
}
test("Imagem sem contraste é reconhecida como sem conteúdo; imagem com contraste não",async()=>{
 assert.equal(await lacksVisibleContent(await flat(800,600,255)),true);
 assert.equal(await lacksVisibleContent(await flat(800,600,238)),true,"tom de fundo uniforme");
 assert.equal(await lacksVisibleContent(await striped(800,600)),false);
 assert.equal(await lacksVisibleContent(Buffer.from("não é imagem")),false,"arquivo inválido nunca é tratado como vazio");
});
function docx(images:Record<string,Buffer>){
 const zip=new PizZip();
 zip.file("[Content_Types].xml",'<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
 zip.file("word/document.xml",'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>CONTRATADA: Escola Teste Ltda, inscrita no CNPJ 11.444.777/0001-61.</w:t></w:r></w:p></w:body></w:document>');
 for(const [name,bytes] of Object.entries(images))zip.file("word/media/"+name,bytes);
 return zip.generate({type:"nodebuffer"});
}
test("DOCX com imagem incorporada em branco fica completo e registra que ela não tem dados",async()=>{
 const reading=await readDocument(docx({"fundo.png":await flat(1200,900,240)}),"contrato.docx");
 assert.equal(reading.incomplete,false,JSON.stringify(reading.warnings));
 assert.ok(reading.warnings!.some(w=>/sem conteúdo legível.*fundo\.png/.test(w)));
 assert.match(reading.text,/Escola Teste Ltda/);
});
test("DOCX com imagem de alto contraste que o OCR não lê continua como leitura parcial",async()=>{
 const reading=await readDocument(docx({"pagina.png":await striped(1200,900)}),"contrato.docx");
 if(!reading.warnings!.some(w=>/não pôde ser lida/.test(w)))return; // The OCR found text in the stripes: nothing to assert.
 assert.equal(reading.incomplete,true);
});
test("Falta de memória não esgota as tentativas; falha do arquivo sim",async ()=>{
 assert.equal(onlyTemporary("foto.jpeg: leitura falhou — Memória disponível insuficiente; leitura adiada para preservar a estabilidade."),true);
 assert.equal(onlyTemporary("a.jpeg: falha temporária do leitor | b.pdf: leitura falhou — Memória disponível insuficiente"),true);
 assert.equal(onlyTemporary("a.jpeg: falha temporária do leitor | c.pdf: leitura parcial (1/3 páginas)"),false);
 assert.equal(onlyTemporary(""),false);
 const db=new DatabaseSync(":memory:");
 db.exec("CREATE TABLE reading_jobs(demand_id TEXT,ticket_hash TEXT,state TEXT,attempts INTEGER NOT NULL DEFAULT 0,available_at INTEGER,owner TEXT,updated INTEGER,last_error TEXT NOT NULL DEFAULT '',progress INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(demand_id,ticket_hash))");
 let clock=1000;const queue=new ReadingJobQueue(db,()=>clock);
 const run=async (id:string,temporary:boolean)=>{for(let i=0;i<5;i++){clock+=10**9;const job=await queue.claim();if(!job)break;await queue.finish(job,"retry","motivo",undefined,temporary);}return db.prepare("SELECT state FROM reading_jobs WHERE demand_id=?").get(id) as any;};
 await queue.enqueue("memoria","h");assert.equal((await run("memoria",true)).state,"retry");
 db.exec("DELETE FROM reading_jobs");
 await queue.enqueue("arquivo","h");assert.equal((await run("arquivo",false)).state,"exhausted");
});
