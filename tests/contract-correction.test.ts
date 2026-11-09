import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
process.env.DATABASE_PATH=join(mkdtempSync(join(tmpdir(),"kedu-correction-")),"test.sqlite");
process.env.NODE_ENV="test";process.env.DEMO_SEED="false";process.env.GLPI_MODE="demo";
const {run,now}=await import("../server/db.js");
const {conversationReferences}=await import("../server/request-expectations.js");
const {buildProcessingPlan,ensureProcessing}=await import("../server/contract-processing.js");
const {processingSummaryReport}=await import("../server/processing-summary.js");
const {registerOfficialCatalog}=await import("../server/official-templates.js");
registerOfficialCatalog();
const A="11.444.777/0001-61",B="22.333.444/0001-81";
const ticket=(followups:any[])=>({content:`<p>RAZÃO SOCIAL: Escola Teste Ltda</p><p>CNPJ: ${A}</p>`,followups});
test("Correção explícita na conversa passa a valer e o valor anterior fica registrado",()=>{
 const {fields,corrections}=conversationReferences(ticket([{id:"9",date:"2026-11-02 10:00:00",content:`<p>Correção: o CNPJ correto é o abaixo.</p><p>CNPJ: ${B}</p>`}]));
 assert.deepEqual(fields.cnpj,[B]);
 assert.deepEqual(corrections.cnpj,{previous:[A],value:B,date:"2026-11-02 10:00:00",message:"9"});
 assert.deepEqual(fields.razaoSocial,["Escola Teste Ltda"]);
});
test("Valor novo sem palavra de correção continua ambíguo para decisão humana",()=>{
 const {fields,corrections}=conversationReferences(ticket([{id:"9",date:"2026-11-02",content:`<p>Segue outro dado.</p><p>CNPJ: ${B}</p>`}]));
 assert.equal(fields.cnpj.length,2);assert.equal(corrections.cnpj,undefined);
});
test("Mensagem privada não corrige; a ordem é a das datas, não a da lista",()=>{
 assert.deepEqual(conversationReferences(ticket([{id:"9",date:"2026-11-02",private:true,content:`<p>Correção do pedido.</p><p>CNPJ: ${B}</p>`}])).fields.cnpj,[A]);
 const C="33.444.555/0001-81";
 const later=conversationReferences(ticket([{id:"2",date:"2026-11-05",content:`<p>Retificando o pedido.</p><p>CNPJ: ${C}</p>`},{id:"1",date:"2026-11-02",content:`<p>Correção do pedido.</p><p>CNPJ: ${B}</p>`}]));
 assert.deepEqual(later.fields.cnpj,[C]);assert.deepEqual(later.corrections.cnpj.previous,[B]);
});
test("Repetir o mesmo valor com palavra de correção não cria correção",()=>{
 const {fields,corrections}=conversationReferences(ticket([{id:"9",date:"2026-11-02",content:`<p>O CNPJ correto: ${A}</p>`}]));
 assert.deepEqual(fields.cnpj,[A]);assert.equal(corrections.cnpj,undefined);
});
run("INSERT INTO users VALUES('u','Teste','u@test.local','Administrador','unused')");
run("INSERT INTO schools VALUES('s','Escola Teste Ltda','Escola Teste Ltda','11.444.777/0001-61','','')");
function demand(id:string,type:string,title:string,followups:any[]=[]){
 const raw={externalId:id,title,status:'2',content:`<p>RAZÃO SOCIAL: Escola Teste Ltda</p><p>CNPJ: ${A}</p>`,followups,documents:[{id:'1',name:'Contrato.pdf'}],documentsAvailable:true};
 run("INSERT INTO demands(id,glpi_id,school_id,type,stage,priority,owner,due,data,created) VALUES(?,?,?,?,'Recebido','Normal','u','','{}',?)",id,id,'s',type,now());
 run('INSERT INTO glpi_tickets VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',id,'real',title,'2','hash-'+id,JSON.stringify(raw),'{}','vinculado',id,now(),now(),null);
 ensureProcessing(id);
 run('INSERT INTO processing_files VALUES(?,?,?,?,?,?,?,?,?,?)',id+'-1',id,'1','hash-'+id,'Contrato.pdf','application/pdf',Buffer.from('x'),JSON.stringify({version:4,text:`CONTRATADA: Escola Teste Ltda, inscrita no CNPJ ${B}`,fields:{razaoSocial:['Escola Teste Ltda'],cnpj:[B]},digitalFields:{razaoSocial:['Escola Teste Ltda'],cnpj:[B]},fieldOrigins:{cnpj:[{value:B,page:2,excerpt:`inscrita no CNPJ ${B}`}]},problem:'',method:'Texto do PDF',pages:3,needsReview:false}),'',now());
}
test("Tipo sem modelo oficial só lista os erros, sem pedir modelo nem campos de modelo",()=>{
 demand('sem-modelo','Análise contratual','JURIDICO : ANÁLISE CONTRATUAL');
 const plan=buildProcessingPlan('sem-modelo')!;
 assert.equal(plan.templates.length,0,'premissa: não há modelo para este tipo');
 assert.ok(!plan.issues.some((i:any)=>i.field==='template'),JSON.stringify(plan.issues.map((i:any)=>i.field)));
 assert.equal(plan.typeIdentification.correction,'Lista de erros (tipo sem modelo oficial)');
 assert.equal(plan.comparisons.find((c:any)=>c.field==='cnpj').status,'different','o erro continua apontado');
});
test("Tipo com modelo oficial continua exigindo o modelo",()=>{
 demand('com-modelo','Contrato de garantia','JURIDICO : SOLICITAÇÃO DE CONTRATO PARA ESCOLAS');
 const plan=buildProcessingPlan('com-modelo')!;
 assert.ok(plan.templates.length>0);assert.equal(plan.typeIdentification.correction,'Modelo oficial');
 assert.ok(plan.issues.some((i:any)=>['template','templateApproval'].includes(i.field)),JSON.stringify(plan.issues.map((i:any)=>i.field)));
});
test("Correção na conversa resolve a referência e a comparação usa o valor corrigido",()=>{
 demand('conversa','Análise contratual','JURIDICO : ANÁLISE CONTRATUAL',[{id:'7',date:'2026-11-03 09:00:00',content:`<p>Correção do pedido.</p><p>CNPJ: ${B}</p>`}]);
 const row=buildProcessingPlan('conversa')!.comparisons.find((c:any)=>c.field==='cnpj');
 assert.equal(row.status,'matches');assert.deepEqual(row.referenceCorrection.previous,[A]);
});
test("Resumo de correção mostra o erro, o valor correto e onde está no documento",()=>{
 const report=processingSummaryReport('Aguardando correção',[{id:'d1',glpi_id:'123',school:'Escola',type:'Análise contratual',status:'Aguardando correção',
  issues:[{field:'cnpj',label:'CNPJ',message:'O documento difere do pedido.'},{field:'rua',label:'Rua',message:'Preencha este dado.'}],
  comparisons:[{field:'cnpj',label:'CNPJ',status:'different',found:B,expected:A,evidence:[{fileName:'Contrato.pdf',page:2,excerpt:`inscrita no CNPJ ${B}`}]},{field:'razaoSocial',status:'matches'}]}]);
 assert.match(report.markdown,/Erros e onde corrigir/);
 assert.match(report.markdown,new RegExp(`no documento está “${B.replace(/[./]/g,'\\$&')}”; o correto, conforme o chamado, é “${A.replace(/[./]/g,'\\$&')}”`));
 assert.match(report.markdown,/Onde: arquivo "Contrato\.pdf", página 2, trecho: “inscrita no CNPJ/);
 assert.equal((report.markdown.match(/\*\*CNPJ\*\*/g)||[]).length,1,'o erro não aparece duplicado nas demais pendências');
 assert.match(report.markdown,/\*\*Rua\*\*/);
});
