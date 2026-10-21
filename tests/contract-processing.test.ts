import {test,after} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {readingImage} from "./reading-fixtures.js";
import express from "express";
import PizZip from "pizzip";
process.env.DATABASE_PATH=join(mkdtempSync(join(tmpdir(),"kedu-process-")),"test.sqlite");
process.env.NODE_ENV="test";process.env.DEMO_SEED="false";process.env.GLPI_MODE="demo";
const {one,all,run,now}=await import("../server/db.js");
const {registerOfficialCatalog,sha256}=await import("../server/official-templates.js");
const {demoTemplate,paragraphs}=await import("../server/documents.js");
const {processContract,saveProcessingResult,buildProcessingPlan,ensureProcessing}=await import("../server/contract-processing.js");
const {registerProcessingRoutes,processingView}=await import("../server/processing-routes.js");
const {inputLabels}=await import("../server/processing-extract.js");
run("INSERT INTO users VALUES('u','Teste','u@test.local','Administrador','unused')");
run("INSERT INTO schools VALUES('s','Escola teste','Escola teste','11.444.777/0001-61','','')");
registerOfficialCatalog();
const template=one("SELECT v.* FROM template_versions v JOIN template_sources s ON s.version_id=v.id WHERE s.modality='Garantia Completa'");
run("INSERT INTO template_homologations VALUES(?,?,?,?,?)",template.id,"u","Homologação simulada para teste",now(),sha256(Buffer.from(template.bytes)));
run("UPDATE template_versions SET status='aprovado',approved_by='u' WHERE id=?",template.id);
const data={razaoSocial:"Escola teste",nomeFantasia:"Escola teste",cnpj:"11.444.777/0001-61",rua:"Rua Teste",numero:"10",bairro:"Centro",cidade:"Fortaleza",estado:"Estado do Ceará",cep:"60000-000",representanteNome:"Representante Teste",representanteCpf:"000.000.000-00",dataFormalizacao:"2026-10-21",alunos:"100",incorporaMatricula:"Sim",cashbackValor:"0,00",remuneracao:"11,84%",valor:"10000,00",inicio:"2030-01-01",fim:"2031-01-01",duracaoMeses:"12",banco:"Banco teste",conta:"001-2",agencia:"0001",titularConta:"Escola teste",documentoTitular:"11.444.777/0001-61",parcelas:"12",repasse:"88,16%",diaRepasse:"10",modalidade:"Garantia Completa"};
function doc(values:Record<string,string>) {
 const zip=new PizZip(demoTemplate());
 zip.file("word/document.xml",'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+Object.entries(values).map(([k,v])=>'<w:p><w:r><w:t>'+(inputLabels[k]||k)+': '+v.replaceAll('&','&amp;')+'</w:t></w:r></w:p>').join('')+'</w:body></w:document>');
 return zip.generate({type:"nodebuffer"});
}
function fixture(id:string,extension="docx") {
 const raw={externalId:id,title:"JURIDICO : SOLICITAÇÃO DE CONTRATO PARA ESCOLAS",content:"<p>RAZÃO SOCIAL: Escola teste</p><p>CNPJ: 11.444.777/0001-61</p><p>TAXA DE REMUNERAÇÃO: 11,84%</p>",documents:[{id:"7",name:"Contrato."+extension}],documentsAvailable:true,followups:[],groups:[],status:"2",created:"",updated:"",category:""};
 run("INSERT INTO demands(id,glpi_id,school_id,type,stage,priority,owner,due,data,created) VALUES(?,?,?,'Contrato de garantia','Recebido','Normal','u','','{}',?)",id,id,"s",now());
 run("INSERT INTO glpi_tickets VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",id,"real",raw.title,"2","hash-"+id,JSON.stringify(raw),"{}","vinculado",id,now(),now(),null);
 return raw;
}
const mock=(values:Record<string,string>=data,name="Contrato.docx")=>async()=>({bytes:doc(values),name,mime:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"});
const app=express();app.use(express.json());app.use((req:any,_res,next)=>{req.user={id:"u",role:req.headers["x-role"]||"Administrador"};next();});
registerProcessingRoutes(app);app.use((err:any,_req:any,res:any,_next:any)=>res.status(err.status||400).json({error:err.message}));
const server=app.listen(0,"127.0.0.1");await new Promise<void>(resolve=>server.on("listening",resolve));after(()=>server.close());
const base=`http://127.0.0.1:${(server.address() as any).port}/api/demands`;
function completed(did:string){const result=processingView(did);assert.ok(result && "template" in result,"A análise deve ter terminado");return result;}
test("Leitura automática identifica dados e modelo e libera download sem formulário manual quando tudo está correto",async()=>{
 fixture("good");await processContract("good","u",mock() as any);
 const result=completed("good");assert.equal(result.status,"Pronto para download",JSON.stringify(result.issues));
 assert.equal(result.template.modality,"Garantia Completa");assert.equal(result.values.remuneracao,"11,84%");
 const response=await fetch(base+"/good/processing/export",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({revision:result.revision})});
 assert.equal(response.status,200,await response.clone().text());const output=await response.json();
 const file=await fetch(`http://127.0.0.1:${(server.address() as any).port}`+output.url);assert.equal(file.status,200);
 const bytes=Buffer.from(await file.arrayBuffer());const text=paragraphs(bytes).join(" ");assert.match(text,/11,84%/);assert.match(text,/Escola teste/);
 assert.equal(one("SELECT confirmed FROM demands WHERE id='good'").confirmed,0,"download não declara conferência humana ou assinatura");
 const again=await fetch(base+"/good/processing/export",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({revision:result.revision})});assert.equal((await again.json()).id,output.id);
 run("UPDATE glpi_tickets SET hash='alterado' WHERE external_id='good'");
 assert.equal((await fetch(`http://127.0.0.1:${(server.address() as any).port}`+output.url)).status,409);
});
test("Divergência bloqueia download, correção explícita gera nova análise e preserva o documento original",async()=>{
 fixture("wrong");await processContract("wrong","u",mock({...data,remuneracao:"11,00%"}) as any);
 const before=completed("wrong");assert.equal(before.status,"Aguardando correção");assert.ok(before.issues.some((i:any)=>i.field==="remuneracao"));
 const denied=await fetch(base+"/wrong/processing/export",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({revision:before.revision})});assert.equal(denied.status,409);
 const source=Buffer.from(one("SELECT bytes FROM processing_files WHERE demand_id='wrong'").bytes);
 const form=new FormData();form.set("revision",String(before.revision));form.set("values",JSON.stringify({remuneracao:"11,84%"}));
 const response=await fetch(base+"/wrong/processing/correct",{method:"POST",body:form});assert.equal(response.status,200);const corrected=await response.json();assert.equal(corrected.status,"Pronto para download",JSON.stringify(corrected.issues));
 assert.deepEqual(Buffer.from(one("SELECT bytes FROM processing_files WHERE demand_id='wrong'").bytes),source);
 const stale=new FormData();stale.set("revision",String(before.revision));stale.set("values","{}");assert.equal((await fetch(base+"/wrong/processing/correct",{method:"POST",body:stale})).status,409);
});
test("Imagem e modelo sem homologação não são liberados como corretos",async()=>{
 fixture("image","png");await processContract("image","u",mock(data,"Contrato.png") as any);assert.equal(completed("image").status,"Aguardando análise");
 assert.ok(completed("image").issues.some((i:any)=>i.field.startsWith("file:")));
 fixture("draft");await processContract("draft","u",mock({...data,modalidade:"Garantia Conjunta"}) as any);
 const draft=completed("draft");assert.equal(draft.status,"Aguardando correção");assert.ok(draft.issues.some((i:any)=>i.field==="templateApproval"));
});

test("Visualização do original com pendências preserva bytes e exige permissão",async()=>{
 fixture("view","png");
 const bytes=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
 await processContract("view","u",(async()=>({bytes,name:"anexo.png",mime:"image/png"})) as any);
 const result=completed("view");assert.equal(result.status,"Aguardando análise");
 const url=base+"/view/processing/files/"+result.files[0].id+"/view";
 const response=await fetch(url);assert.equal(response.status,200);
 assert.equal(response.headers.get("content-disposition"),"inline");
 assert.equal(response.headers.get("content-type"),"image/png");
 assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
 assert.equal((await fetch(url,{headers:{"x-role":"Consulta"}})).status,403);
 assert.equal((await fetch(base+"/wrong/processing/files/"+result.files[0].id+"/view")).status,404);
 const docx=one("SELECT id FROM processing_files WHERE demand_id='wrong'");
 assert.equal((await fetch(base+"/wrong/processing/files/"+docx.id+"/view")).status,415);
});

test("OCR permanece bloqueado até conferência humana; confirmação respeita revisão e acesso",async()=>{
 fixture("ocr","png");const bytes=readingImage().toBuffer("image/png");
 await processContract("ocr","u",(async()=>({bytes,name:"contrato.png",mime:"image/png"})) as any);
 const result=completed("ocr");assert.equal(result.status,"Aguardando análise");assert.equal(result.values.remuneracao,"11,84%");assert.equal(result.files[0].needsReview,true);
 const url=base+"/ocr/processing/files/"+result.files[0].id+"/confirm";
 const post=(revision:number,role="Administrador")=>fetch(url,{method:"POST",headers:{"Content-Type":"application/json","x-role":role},body:JSON.stringify({revision,confirmed:true})});
 assert.equal((await post(result.revision,"Consulta")).status,403);
 assert.equal((await post(result.revision-1)).status,409);
 const response=await post(result.revision);assert.equal(response.status,200);const confirmed=await response.json();assert.equal(confirmed.files[0].needsReview,false);assert.equal(confirmed.status,"Aguardando correção","campos obrigatórios continuam sendo validados");
 assert.equal((await post(result.revision)).status,409);
 assert.deepEqual(Buffer.from(one("SELECT bytes FROM processing_files WHERE demand_id='ocr'").bytes),bytes);
});
test("Substituição manual de imagem por DOCX legível preenche os dados e libera a validação",async()=>{
 const before=completed("image"),original=one("SELECT id,bytes FROM processing_files WHERE demand_id='image' ORDER BY rowid LIMIT 1");
 const f=new FormData();f.set("revision",String(before.revision));f.set("values","{}");f.set("document_id","7");f.set("file",new Blob([new Uint8Array(doc(data))]),"Contrato-corrigido.docx");
 const response=await fetch(base+"/image/processing/correct",{method:"POST",body:f});assert.equal(response.status,200);const result=await response.json();assert.equal(result.status,"Pronto para download",JSON.stringify(result.issues));
 assert.equal(one("SELECT COUNT(*) n FROM processing_files WHERE demand_id='image'").n,2);
 assert.deepEqual(Buffer.from(one("SELECT bytes FROM processing_files WHERE id=?",original.id).bytes),Buffer.from(original.bytes));
});
test("Prévia permite homologar o modelo sem liberar contrato pendente",async()=>{
 const response=await fetch(base+"/draft/processing/preview",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});assert.equal(response.status,200);const result=await response.json();
 const preview=one("SELECT * FROM template_previews WHERE id=?",result.id);
 assert.match(paragraphs(Buffer.from(preview.bytes)).join(" "),/NÃO UTILIZAR PARA ASSINATURA/);
 assert.equal(completed("draft").status,"Aguardando correção");
 assert.equal(one("SELECT COUNT(*) n FROM processing_exports WHERE demand_id='draft'").n,0);
});
test("Aditivo só reserva o próximo número ao baixar; repetição usa o mesmo contrato e arquivo",async()=>{
 const raw=fixture("addendum");raw.title="Solicitação de aditivo";raw.content+="<p>MOTIVO DO ADITIVO: Alteração de taxa</p>";
 run("UPDATE glpi_tickets SET payload=?,title=? WHERE external_id='addendum'",JSON.stringify(raw),raw.title);
 run("INSERT INTO contracts(id,school_id,status) VALUES('matrix','s','Assinado')");
 run("INSERT INTO signed_history VALUES('history','matrix',0,'Clicksign','Referência de teste','2020-01-01','u',?)",now());
 const t=one("SELECT v.* FROM template_versions v JOIN template_catalog c ON c.version_id=v.id WHERE c.subtype='Taxa de remuneração' LIMIT 1");
 run("INSERT INTO template_homologations VALUES(?,?,?,?,?)",t.id,"u","Homologação de teste do aditivo",now(),sha256(Buffer.from(t.bytes)));run("UPDATE template_versions SET status='aprovado',approved_by='u' WHERE id=?",t.id);
 await processContract("addendum","u",mock({...data,dataAssinaturaMatriz:"2020-01-01"}) as any);
 const result=completed("addendum");assert.equal(result.status,"Pronto para download",JSON.stringify(result.issues));
 assert.equal(one("SELECT COUNT(*) n FROM contracts WHERE parent_id='matrix'").n,0);
 const post=()=>fetch(base+"/addendum/processing/export",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({revision:result.revision})});
 const first=await post();assert.equal(first.status,200,await first.clone().text());const output=await first.json();
 assert.equal(one("SELECT COUNT(*) n FROM contracts WHERE parent_id='matrix' AND sequence=1").n,1);
 const second=await post();assert.equal(second.status,200,await second.clone().text());assert.equal((await second.json()).id,output.id);
 assert.equal(one("SELECT COUNT(*) n FROM contracts WHERE parent_id='matrix'").n,1);
});
test("Perfil sem permissão não lê dados extraídos nem libera contrato",async()=>{
 assert.equal((await fetch(base+"/wrong/processing",{headers:{"x-role":"Consulta"}})).status,403);
 assert.equal((await fetch(base+"/wrong/processing/export",{method:"POST",headers:{"Content-Type":"application/json","x-role":"Consulta"},body:JSON.stringify({revision:1})})).status,403);
});
test("Modelo de garantia não é usado para contrato educacional, mesmo quando enviado diretamente à API",async()=>{
 const raw=fixture("education");raw.title="Solicitação de contratos diversos";raw.content+="<p>ESPECIFIQUE O CONTRATO: Contrato educacional Kedu Matrículas</p>";
 run("UPDATE glpi_tickets SET payload=?,title=? WHERE external_id='education'",JSON.stringify(raw),raw.title);
 await processContract("education","u",mock() as any);
 const result=completed("education");assert.equal(result.status,"Aguardando correção");assert.equal(result.templates.length,0);
 const f=new FormData();f.set("revision",String(result.revision));f.set("values","{}");f.set("template_id",template.id);
 const response=await fetch(base+"/education/processing/correct",{method:"POST",body:f});assert.equal(response.status,200);assert.equal((await response.json()).status,"Aguardando correção");
});
