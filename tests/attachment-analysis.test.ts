import { test,after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import PizZip from "pizzip";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DATABASE_PATH=join(mkdtempSync(join(tmpdir(),"kedu-attachment-")),"test.sqlite");
process.env.NODE_ENV="test";process.env.DEMO_SEED="false";process.env.GLPI_MODE="demo";
const { run, one, all, sql } = await import("../server/db.js");
const {demoTemplate,preflight}=await import("../server/documents.js");
const {randomBytes}=await import("node:crypto");
const {inspectAttachment}=await import("../server/attachment-analysis.js");
const {registerAttachmentRoutes}=await import("../server/attachment-routes.js");
const {governanceMissing}=await import("../server/governance.js");
const {analyzeTicket}=await import("../server/glpi-analysis.js");
function doc(...lines:string[]) {
  const zip=new PizZip(demoTemplate());
  zip.file("word/document.xml",'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+lines.map(s=>'<w:p><w:r><w:t>'+s.replaceAll('&','&amp;').replaceAll('<','&lt;')+'</w:t></w:r></w:p>').join('')+'</w:body></w:document>');
  return zip.generate({type:"nodebuffer"});
}
test("Compara campos identificados e mostra valor esperado, encontrado e correção",()=>{
  const r=inspectAttachment(doc("CNPJ: 11.444.777/0001-61","Taxa de remuneração: 11%"),"contrato.docx",{cnpj:"11.444.777/0001-61",remuneracao:"11,84%"});
  assert.equal(r.status,"divergente");
  assert.equal(r.findings[1].expected,"11,84%");assert.equal(r.findings[1].found,"11%");assert.match(r.findings[1].guidance,/11,84%/);
  assert.match(r.findings[1].location,/Parágrafo 2/);
});
test("Equivalência numérica não cria divergência de formato e valores monetários são comparados",()=>{
  assert.equal(inspectAttachment(doc("Taxa de remuneração: 11%","Valor de referência: R$ 10.000,00"),"contrato.docx",{remuneracao:"11,00%",valor:"10000,00"}).status,"conforme");
});
test("Texto com logotipo e cabeçalho é lido, mas revisões ocultas impedem resultado conforme",()=>{
  const zip=new PizZip(doc("Taxa de remuneração: 11,84%"));
  zip.file("word/header1.xml",'<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Contrato de prestação de serviços</w:t></w:r></w:p></w:hdr>');
  zip.file("word/document.xml",zip.file("word/document.xml")!.asText().replace("</w:body>","<w:p><w:r><w:drawing/></w:r></w:p></w:body>"));
  assert.equal(inspectAttachment(zip.generate({type:"nodebuffer"}),"contrato.docx",{remuneracao:"11,84%"}).status,"conforme");
  zip.file("word/document.xml",zip.file("word/document.xml")!.asText().replace("<w:t>","<w:rPr><w:vanish/></w:rPr><w:t>"));
  assert.equal(inspectAttachment(zip.generate({type:"nodebuffer"}),"contrato.docx",{remuneracao:"11,84%"}).status,"inconclusiva");
});
test("Imagem oculta e fontes incorporadas grandes não impedem a leitura do texto recebido",()=>{
  const zip=new PizZip(doc("Taxa de remuneração: 11,84%"));
  zip.file("word/document.xml",zip.file("word/document.xml")!.asText().replace("</w:body>","<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:drawing/></w:r></w:p></w:body>"));
  assert.equal(inspectAttachment(zip.generate({type:"nodebuffer"}),"contrato.docx",{remuneracao:"11,84%"}).status,"conforme","imagem oculta não altera o texto");
  // Embedded fonts are binary; only a sane compression ratio is required, not the 20 MB text limit.
  zip.file("word/fonts/font1.odttf",randomBytes(21_000_000),{compression:"STORE"});
  const withFont=zip.generate({type:"nodebuffer"});
  assert.equal(inspectAttachment(withFont,"contrato.docx",{remuneracao:"11,84%"}).status,"conforme");
  assert.throws(()=>preflight(withFont),/excede 20 MB/,"modelos gerados pelo portal mantêm o limite estrito");
  const bomb=new PizZip(doc("Taxa de remuneração: 11,84%"));
  bomb.file("word/fonts/font1.odttf",Buffer.alloc(21_000_000),{compression:"DEFLATE"});
  assert.equal(inspectAttachment(bomb.generate({type:"nodebuffer",compression:"DEFLATE"}),"contrato.docx",{remuneracao:"11,84%"}).status,"inconclusiva","arquivo que se expande demais continua recusado");
});
test("Múltiplos valores, campo ausente, DOCX inválido e imagem nunca são considerados conformes",()=>{
  for(const [bytes,name] of [[doc("Taxa de 11% para 11,84%"),"contrato.docx"],[doc("Documento sem taxa identificada"),"contrato.docx"],[Buffer.from("invalido"),"contrato.docx"],[Buffer.from("imagem"),"anexo.png"]] as [Buffer,string][])assert.equal(inspectAttachment(bytes,name,{remuneracao:"11,84%"}).status,"inconclusiva");
});
const raw={externalId:"9001",title:"Solicitação de aditivo",content:"<p>RAZÃO SOCIAL: Escola teste</p><p>CNPJ: 11.444.777/0001-61</p><p>OBSERVAÇÕES: Alteração de taxa de 11% para 11,84% a partir de Dezembro/2026</p>",documents:[{id:"7",name:"contrato.docx"},{id:"8",name:"anexo.png"}],followups:[],groups:[],status:"2",created:"",updated:"",category:"",documentsAvailable:true};
test("Extrai a nova taxa explícita do pedido e preserva a origem sem usar a taxa anterior",()=>{
  const a=analyzeTicket(raw as any,{schools:[],matrices:[]});assert.equal(a.fields.remuneracao.value,"11,84%");assert.match(a.fields.remuneracao.origin,/nova taxa explicitamente/);
});
await sql.run("INSERT INTO users VALUES('u','Operador','u@test.local','Administrador','unused')");
await sql.run("INSERT INTO schools VALUES('s','Escola teste','Escola teste','11.444.777/0001-61','','')");
await sql.run("INSERT INTO demands(id,glpi_id,school_id,type,stage,priority,owner,due,data,created) VALUES('d','9001','s','Contrato educacional','Recebido','Normal','u','','{}','2026-10-21')");
await sql.run("INSERT INTO glpi_tickets VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", "9001", "real", raw.title, "2", "hash1", JSON.stringify(raw), "{}", "vinculado", "d", "2026-10-21", "2026-10-21", null);
let downloads=0;
const app=express();app.use((req:any,_res,next)=>{req.user={id:"u",role:req.headers["x-role"]||"Administrador"};next();});
registerAttachmentRoutes(app,async(_ticket,document)=>{downloads++;return document==="8"?{bytes:Buffer.from("imagem"),name:"anexo.png",mime:"application/octet-stream"}:{bytes:doc("CNPJ: 11.444.777/0001-61","Taxa de remuneração: 11%"),name:"contrato.docx",mime:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"};});
app.use((err:any,_req:any,res:any,_next:any)=>res.status(err.status||400).json({error:err.message}));
const server=app.listen(0,"127.0.0.1");await new Promise<void>(resolve=>server.on("listening",resolve));
after(()=>server.close());const base=`http://127.0.0.1:${(server.address() as any).port}/api/demands/d/attachment-checks`;
async function analyze(options:{parent?:string;bytes?:Buffer;role?:string;version?:string;document?:string;hash?:string}={}) {
  const f=new FormData();
  for(const [k,v]of Object.entries({document_id:options.document||"7",expected_version:options.version||"1",expected_hash:options.hash||"hash1",reference:"Solicitação original GLPI conferida pelo operador",expected:JSON.stringify({remuneracao:"11,84%"}),attested:"true"}))f.set(k,v);
  if(options.parent)f.set("parent_id",options.parent);
  if(options.bytes)f.set("file",new Blob([new Uint8Array(options.bytes)]),"corrigido.docx");
  const response=await fetch(base,{method:"POST",body:f,headers:{"x-role":options.role||"Administrador"}});return {status:response.status,data:await response.json()};
}
test("Fluxo de anexo preserva original, encaminha erro à correção e guarda nova versão para visualizar e baixar",async()=>{
  const original=await analyze();assert.equal(original.status,200);assert.equal(original.data.status,"divergente");
  assert.equal((await sql.one("SELECT stage FROM demands WHERE id='d'")).stage,"Devolvido");
  assert.ok((await governanceMissing(await sql.one("SELECT * FROM demands WHERE id='d'"))).some(s=>s.includes("correção manual")));
  const fixed=doc("Taxa de remuneração: 11,84%");
  const corrected=await analyze({parent:original.data.id,bytes:fixed});assert.equal(corrected.status,200);assert.equal(corrected.data.status,"conforme");
  assert.equal((await sql.one("SELECT COUNT(*) n FROM attachment_checks")).n,2);
  assert.equal((await sql.one("SELECT status FROM attachment_checks WHERE id=?", original.data.id)).status,"divergente");
  assert.equal((await sql.one("SELECT parent_id FROM attachment_checks WHERE id=?", corrected.data.id)).parent_id,original.data.id);
  const preview=await fetch(base+`/${corrected.data.id}/preview`);assert.match((await preview.json()).text,/11,84%/);
  const file=await fetch(base+`/${corrected.data.id}/download`);assert.equal(file.status,200);assert.deepEqual(Buffer.from(await file.arrayBuffer()),fixed);
  assert.equal((await sql.one("SELECT stage FROM demands WHERE id='d'")).stage,"Devolvido","valores corretos não aprovam nem avançam automaticamente o contrato");
});
test("Perfil sem acesso, documento alheio e versões obsoletas são bloqueados antes do download",async()=>{
  const before=downloads;
  assert.equal((await analyze({role:"Consulta"})).status,403);
  assert.notEqual((await analyze({document:"999"})).status,200);
  assert.equal((await analyze({hash:"obsoleto"})).status,409);
  assert.equal((await analyze({version:"999"})).status,409);
  assert.equal(downloads,before);
  assert.equal((await fetch(base+"/"+(await sql.one("SELECT id FROM attachment_checks LIMIT 1")).id+"/download",{headers:{"x-role":"Consulta"}})).status,403);
});
test("Imagem devolve resultado inconclusivo e bloqueia avanço em vez de aprovar",async()=>{
  const result=await analyze({document:"8"});assert.equal(result.status,200);assert.equal(result.data.status,"inconclusiva");
  assert.equal((await sql.one("SELECT stage FROM demands WHERE id='d'")).stage,"Aguardando informações");
  assert.ok((await governanceMissing(await sql.one("SELECT * FROM demands WHERE id='d'"))).some(s=>s.includes("inconclusiva")));
});
