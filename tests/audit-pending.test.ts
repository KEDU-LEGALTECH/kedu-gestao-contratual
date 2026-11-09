import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import express from 'express';
process.env.DATABASE_PATH=join(mkdtempSync(join(tmpdir(),'kedu-audit-')),'test.sqlite');
process.env.NODE_ENV='test';process.env.DEMO_SEED='false';process.env.GLPI_MODE='demo';
const {all,one,run,now}=await import('../server/db.js');
const {buildProcessingPlan,ensureProcessing,scheduleContractProcessing}=await import('../server/contract-processing.js');
const {processingStatus}=await import('../server/processing-status.js');
const {registerProcessingRoutes}=await import('../server/processing-routes.js');
const {supersededDocuments}=await import('../server/document-versions.js');
const {attachmentWithValue}=await import('../server/guided-confirmation.js');
const {needsReadingRecovery}=await import('../server/reading-recovery-policy.js');
const {ReadingJobQueue}=await import('../server/reading-job-queue.js');
const {missingFieldEvidence}=await import('../server/document-evidence.js');
const {pendingReason}=await import('../shared/pending-reason.js');
run("INSERT INTO users VALUES('u','Teste','u@test.local','Administrador','unused')");
run("INSERT INTO schools VALUES('s','Escola Teste Ltda','Escola Teste Ltda','11.444.777/0001-61','','')");
const VALID='11.444.777/0001-61';
function demand(id:string,documents:any[],{cnpj=VALID,status='2',coverage={}}:{cnpj?:string;status?:string;coverage?:any}={}){
 const raw={externalId:id,title:'JURIDICO : SOLICITAÇÃO DE CONTRATO PARA ESCOLAS',status,content:`<p>RAZÃO SOCIAL: Escola Teste Ltda</p><p>CNPJ: ${cnpj}</p>`,followups:[],documents,documentsAvailable:true,...coverage};
 run("INSERT INTO demands(id,glpi_id,school_id,type,stage,priority,owner,due,data,created) VALUES(?,?,?,'Contrato de garantia','Recebido','Normal','u','','{}',?)",id,id,'s',now());
 run('INSERT INTO glpi_tickets VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',id,'real',raw.title,status,'hash-'+id,JSON.stringify(raw),'{}','vinculado',id,now(),now(),null);
 ensureProcessing(id);
}
function file(did:string,documentId:string,name:string,reading:any,problem=''){
 const extracted={version:4,text:'',fields:{},problem,method:'Texto do PDF',pages:1,needsReview:false,...reading};
 run('INSERT INTO processing_files VALUES(?,?,?,?,?,?,?,?,?,?)',did+'-'+documentId,did,documentId,'hash-'+did,name,'application/pdf',Buffer.from('conteudo '+documentId),JSON.stringify(extracted),problem,now());
}
const contract={text:'CONTRATADA: Escola Teste Ltda, inscrita no CNPJ '+VALID,fields:{razaoSocial:['Escola Teste Ltda'],cnpj:[VALID]},digitalFields:{razaoSocial:['Escola Teste Ltda'],cnpj:[VALID]}};
const ocrPhoto={text:'Foto de uma reunião, sem dados cadastrais.',method:'OCR de imagem',needsReview:true,confidence:90};

test('CNPJ da contratada lido com dígitos inválidos aparece com evidência e continua pendente',()=>{
 const invalid='11.444.777/0001-62';
 const text=`CONTRATANTE: KEDU LTDA, inscrita no CNPJ 45.543.580/0001-00.
CONTRATADA: Escola Teste Ltda, inscrita no CNPJ ${invalid}.
AGENTE: Outra Empresa Ltda, inscrita no CNPJ 05.868.278/0001-07.`;
 for(const [id,expected,status] of [['printed-invalid-reference',invalid,'ambiguous'],['printed-invalid-document',VALID,'review']]){
  demand(id,[{id:'1',name:'Contrato.docx'}],{cnpj:expected});
  file(id,'1','Contrato.docx',{text,method:'DOCX'});
  const plan=buildProcessingPlan(id)!;
  const row=plan.comparisons.find(c=>c.field==='cnpj')!;
  assert.equal(row.found,invalid);
  assert.equal(row.status,status);
  assert.equal(pendingReason(row)?.code,'invalid_identifier');
  assert.match(row.evidence[0].excerpt,/Escola Teste Ltda/);
  assert.equal(plan.issues.some(i=>i.field.startsWith('review:parties:')),false);
  assert.equal(processingStatus(plan.issues,plan.comparisons,true),'Conferência parcial');
 }
});

test('Versão: só substitui com mesmo nome e extensão e declaração explícita de revisão',()=>{
 const edu='Contrato Educacional Alfabethus EDUC. INF 2027';
 const links=supersededDocuments([{id:436874,name:edu+'.docx'},{id:438591,name:edu+' - Revisado.docx'}]);
 assert.equal(links.get('436874'),edu+' - Revisado.docx');assert.equal(links.size,1);
 // Later copy suffixes and different files are not versions.
 assert.equal(supersededDocuments([{id:1,name:'WhatsApp Image 2026-10-22.jpeg'},{id:2,name:'WhatsApp Image 2026-10-22 (1).jpeg'}]).size,0);
 assert.equal(supersededDocuments([{id:1,name:'Contrato regular 2027.docx'},{id:2,name:'Contrato regular 2027 (1).docx'}]).size,0);
 assert.equal(supersededDocuments([{id:1,name:'Contrato INTEGRAL 2027.docx'},{id:2,name:'Contrato REGULAR 2027 - Revisado.docx'}]).size,0);
 assert.equal(supersededDocuments([{id:1,name:'Contrato regular 2027.docx'},{id:2,name:'Contrato regular 2027 - Revisado.pdf'}]).size,0);
 // A revised file sent earlier is not replaced by an older-numbered original.
 assert.equal(supersededDocuments([{id:2,name:'Contrato regular 2027.docx'},{id:1,name:'Contrato regular 2027 - Revisado.docx'}]).size,0);
 const chain=supersededDocuments([{id:1,name:'Termo anexo escola.pdf'},{id:2,name:'Termo anexo escola - Revisado.pdf'},{id:3,name:'Termo anexo escola - Revisado v2.pdf'}]);
 assert.equal(chain.get('1'),'Termo anexo escola - Revisado v2.pdf');assert.equal(chain.get('2'),'Termo anexo escola - Revisado v2.pdf');
});
test('Versão clara: o arquivo antigo fica visível, mas não gera divergência nem pendência',()=>{
 const docs=[{id:'1',name:'Contrato escola teste.docx'},{id:'2',name:'Contrato escola teste - Revisado.docx'}];
 demand('version',docs);
 file('version','1','Contrato escola teste.docx',{text:'CONTRATADA: Outra Escola Ltda',method:'DOCX',fields:{razaoSocial:['Outra Escola Ltda']},digitalFields:{razaoSocial:['Outra Escola Ltda']}});
 file('version','2','Contrato escola teste - Revisado.docx',{...contract,method:'DOCX'});
 const plan=buildProcessingPlan('version')!;
 assert.equal(plan.comparisons.find((c:any)=>c.field==='razaoSocial').status,'matches');
 assert.equal(plan.files.length,2);
 assert.equal(plan.files.find((f:any)=>f.document_id==='1')!.supersededBy,'Contrato escola teste - Revisado.docx');
 assert.equal(plan.files.find((f:any)=>f.document_id==='2')!.supersededBy,undefined);
});
test('Versão sem vínculo claro continua como escolha humana',()=>{
 const docs=[{id:'1',name:'Contrato A.docx'},{id:'2',name:'Minuta B.docx'}];
 demand('no-link',docs);
 file('no-link','1','Contrato A.docx',{text:'x',method:'DOCX',fields:{razaoSocial:['Outra Escola Ltda']},digitalFields:{razaoSocial:['Outra Escola Ltda']}});
 file('no-link','2','Minuta B.docx',{...contract,method:'DOCX'});
 const row=buildProcessingPlan('no-link')!.comparisons.find((c:any)=>c.field==='razaoSocial');
 assert.equal(row.status,'review');assert.equal(row.reviewReason.code,'conflicting_values');
});
test('Arquivo lido sem campo aproveitado não bloqueia se os campos estão resolvidos, e fica visível',()=>{
 demand('unused',[{id:'1',name:'Contrato.pdf'},{id:'2',name:'foto.jpeg'}]);
 file('unused','1','Contrato.pdf',contract);file('unused','2','foto.jpeg',ocrPhoto);
 const plan=buildProcessingPlan('unused')!;
 assert.ok(plan.comparisons.every((c:any)=>c.status==='matches'),JSON.stringify(plan.comparisons.map((c:any)=>[c.field,c.status])));
 assert.ok(!plan.issues.some((i:any)=>i.field==='review:unused-2'));
 assert.equal(plan.files.find((f:any)=>f.id==='unused-2')!.notUsed,true);
 assert.equal(plan.files.find((f:any)=>f.id==='unused-1')!.notUsed,false);
 assert.equal(processingStatus(plan.issues,plan.comparisons),'Sem erros');
 assert.equal(one('SELECT count(*) n FROM processing_file_reviews').n,0,'nenhuma conferência humana é criada');
});
test('Arquivo sem campo aproveitado continua bloqueando enquanto há campo pedido sem resolver',()=>{
 demand('unused-open',[{id:'2',name:'foto.jpeg'}]);
 file('unused-open','2','foto.jpeg',ocrPhoto);
 const plan=buildProcessingPlan('unused-open')!;
 assert.ok(plan.issues.some((i:any)=>i.field==='review:unused-open-2'));
 assert.equal(processingStatus(plan.issues,plan.comparisons),'Aguardando análise');
});
test('Leitura parcial sem campo aproveitado nunca é tratada como não utilizada',()=>{
 demand('unused-partial',[{id:'1',name:'Contrato.pdf'},{id:'2',name:'scan.pdf'}]);
 file('unused-partial','1','Contrato.pdf',contract);file('unused-partial','2','scan.pdf',{...ocrPhoto,incomplete:true,pendingPages:[2],pages:2});
 const plan=buildProcessingPlan('unused-partial')!;
 assert.ok(plan.issues.some((i:any)=>i.field==='review:partial:unused-partial-2'));
 assert.equal(plan.files.find((f:any)=>f.id==='unused-partial-2')!.notUsed,false);
 assert.equal(processingStatus(plan.issues,plan.comparisons),'Aguardando análise');
});
test('Valor no texto sem associação recebe estado próprio, sem contar como confere',()=>{
 const files=[{name:'alteracao.pdf',extracted:JSON.stringify({text:'Sócio identificado pelo número '+VALID+' na cláusula.'})}];
 assert.equal(attachmentWithValue('documentoTitular',VALID,files),'alteracao.pdf');
 assert.equal(attachmentWithValue('documentoTitular','22.333.444/0001-81',files),undefined);
 demand('unassociated',[{id:'1',name:'Contrato.pdf'}]);
 run("UPDATE glpi_tickets SET payload=json_set(payload,'$.content',?) WHERE external_id='unassociated'",`<p>RAZÃO SOCIAL: Escola Teste Ltda</p><p>CNPJ: ${VALID}</p><p>CPF/CNPJ DO TITULAR: ${VALID}</p>`);
 file('unassociated','1','Contrato.pdf',contract);
 const row=buildProcessingPlan('unassociated')!.comparisons.find((c:any)=>c.field==='documentoTitular');
 assert.equal(row.status,'missing');assert.equal(row.missingReason,'value_unassociated');assert.match(row.expectedDocument,/bancário/i);
 assert.equal(pendingReason(row)!.label,'Valor encontrado sem associação');
});
test('Cobertura incompleta não afirma que o arquivo não foi enviado',()=>{
 assert.equal(missingFieldEvidence('cnpj',[]).reason,'not_sent');
 const evidence=missingFieldEvidence('cnpj',[],true);
 assert.equal(evidence.reason,'coverage_partial');assert.doesNotMatch(evidence.message,/não enviado/);
 assert.equal(pendingReason({status:'missing',missingReason:'coverage_partial'})!.label,'Cobertura parcial');
 assert.equal(pendingReason({status:'missing',missingReason:'download_pending'})!.label,'Arquivo ainda não importado');
 demand('coverage',[],{coverage:{approvalCoverage:'partial',timelineCoverage:'complete'}});
 const plan=buildProcessingPlan('coverage')!;
 assert.equal(plan.comparisons.find((c:any)=>c.field==='cnpj').missingReason,'coverage_partial');
 const files=plan.issues.find((i:any)=>i.field==='files')!;
 assert.equal(files.pendingReason!.code,'coverage_partial');assert.doesNotMatch(files.message,/não contém contrato/);
 demand('coverage-ok',[],{coverage:{approvalCoverage:'not_required',timelineCoverage:'complete'}});
 assert.equal(buildProcessingPlan('coverage-ok')!.comparisons.find((c:any)=>c.field==='cnpj').missingReason,'not_sent');
});
test('Formato sem leitor não é repetido e tem motivo próprio',()=>{
 const problem='Formato sem leitor disponível. O original foi preservado; envie PDF.';
 assert.equal(needsReadingRecovery({byteLength:10,problem,extracted:JSON.stringify({problem})}),false);
 assert.equal(needsReadingRecovery({byteLength:10,problem:'Nenhum texto legível',extracted:JSON.stringify({})}),true);
 assert.equal(pendingReason({field:'file:1',message:problem})!.code,'unsupported');
});
test('Fila reabre leitura presa: concluída na hora e esgotada só uma vez por dia',()=>{
 const database=new DatabaseSync(':memory:');
 database.exec("CREATE TABLE reading_jobs(demand_id TEXT,ticket_hash TEXT,state TEXT,attempts INTEGER NOT NULL DEFAULT 0,available_at INTEGER,owner TEXT,updated INTEGER,last_error TEXT NOT NULL DEFAULT '',progress INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(demand_id,ticket_hash))");
 let clock=1000000000;
 const queue=new ReadingJobQueue(database,()=>clock);
 const state=(id:string)=>database.prepare('SELECT state,attempts,last_error FROM reading_jobs WHERE demand_id=?').get(id) as any;
 const put=(id:string,s:string,updated:number)=>database.prepare("INSERT INTO reading_jobs(demand_id,ticket_hash,state,attempts,available_at,updated) VALUES(?,'h',?,3,0,?)").run(id,s,updated);
 put('done','done',clock);put('recent','exhausted',clock-3600000);put('old','exhausted',clock-25*3600000);
 for(const id of ['done','recent','old'])queue.enqueue(id,'h',false,true);
 assert.equal(state('done').state,'queued');assert.equal(state('done').attempts,0);
 assert.equal(state('recent').state,'exhausted');
 assert.equal(state('old').state,'queued');
 put('quiet','done',clock);queue.enqueue('quiet','h');
 assert.equal(state('quiet').state,'done','sem recuperação pendente nada muda');
});
test('Chamado encerrado sai da leitura automática, sem perder dados, e volta se for reaberto',async()=>{
 demand('closed',[{id:'1',name:'Novo.pdf'}],{status:'5'});
 const hash='hash-closed',at=Date.now();
 run("INSERT INTO reading_jobs(demand_id,ticket_hash,state,available_at,updated) VALUES('closed',?,'queued',?,?)",hash,at-1000,at-1000);
 run("UPDATE settings SET value='false' WHERE key='documentReadingPaused'");
 // Only this demand may be scanned: the others in this file are test fixtures.
 const others=all("SELECT external_id FROM glpi_tickets WHERE external_id<>'closed'").map(t=>t.external_id);
 for(const id of others)run("UPDATE demands SET stage='Cancelado' WHERE glpi_id=?",id);
 process.env.NODE_ENV='production';
 try{
  scheduleContractProcessing();
  for(let i=0;i<100&&one("SELECT state FROM reading_jobs WHERE demand_id='closed'").state==='queued';i++)await new Promise(r=>setTimeout(r,20));
 }finally{process.env.NODE_ENV='test';}
 const job=one("SELECT state,last_error FROM reading_jobs WHERE demand_id='closed'");
 assert.equal(job.state,'superseded');assert.match(job.last_error,/encerrado no GLPI/);
 assert.equal(one("SELECT count(*) n FROM processing_files WHERE demand_id='closed'").n,0,'nada foi baixado');
 assert.ok(one("SELECT 1 x FROM glpi_tickets WHERE external_id='closed' AND json_array_length(payload,'$.documents')=1"),'a lista de anexos é preservada');
 // Reopening changes the status, so the ticket version, and the reading returns by itself.
 run("UPDATE glpi_tickets SET status='2',hash='hash-closed-2' WHERE external_id='closed'");
 process.env.NODE_ENV='production';
 try{
  scheduleContractProcessing();
  for(let i=0;i<200&&!one("SELECT 1 x FROM processing_files WHERE demand_id='closed' AND ticket_hash='hash-closed-2'");i++)await new Promise(r=>setTimeout(r,20));
 }finally{run("UPDATE settings SET value='true' WHERE key='documentReadingPaused'");process.env.NODE_ENV='test';}
 assert.ok(one("SELECT 1 x FROM reading_jobs WHERE demand_id='closed' AND ticket_hash='hash-closed-2'"),'chamado reaberto volta à fila');
 assert.ok(one("SELECT 1 x FROM processing_files WHERE demand_id='closed' AND ticket_hash='hash-closed-2'"),'chamado reaberto volta a ser lido');
 for(let i=0;i<100&&one("SELECT state FROM reading_jobs WHERE demand_id='closed' AND ticket_hash='hash-closed-2'").state==='running';i++)await new Promise(r=>setTimeout(r,20));
 for(const id of others)run("UPDATE demands SET stage='Recebido' WHERE glpi_id=?",id);
});
const app=express();app.use(express.json());
app.use((req:any,_res,next)=>{req.user={id:'u',role:'Administrador'};next();});
registerProcessingRoutes(app);
app.use((error:any,_req:any,res:any,_next:any)=>res.status(error.status||400).json({error:error.message}));
const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.on('listening',r));after(()=>server.close());
const post=(did:string,body:any)=>fetch(`http://127.0.0.1:${(server.address() as any).port}/api/demands/${did}/processing/resolutions`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmed:true,...body})});
const revision=(did:string)=>one('SELECT revision FROM contract_processing WHERE demand_id=?',did).revision;
test('Referência ambígua: decisão humana libera o campo, fica na auditoria e cai se o GLPI mudar',async()=>{
 const INVALID='11.444.777/0001-62';
 demand('reference',[{id:'1',name:'Contrato.pdf'}],{cnpj:INVALID});file('reference','1','Contrato.pdf',contract);
 run("UPDATE contract_processing SET status='Aguardando análise' WHERE demand_id='reference'");
 const before=buildProcessingPlan('reference')!.comparisons.find((c:any)=>c.field==='cnpj');
 assert.equal(before.status,'ambiguous');
 assert.equal((await post('reference',{revision:revision('reference'),kind:'reference',field:'cnpj',value:INVALID,note:'Conferido no cadastro'})).status,400,'documento inválido é recusado');
 assert.equal((await post('reference',{revision:revision('reference'),kind:'reference',field:'cnpj',value:VALID,note:'x'})).status,400,'justificativa é obrigatória');
 assert.equal((await post('reference',{revision:1000,kind:'reference',field:'cnpj',value:VALID,note:'Conferido no cadastro'})).status,409);
 const saved=await post('reference',{revision:revision('reference'),kind:'reference',field:'cnpj',value:VALID,note:'Conferido no cartão CNPJ'});
 assert.equal(saved.status,200,await saved.clone().text());
 const row=buildProcessingPlan('reference')!.comparisons.find((c:any)=>c.field==='cnpj');
 assert.equal(row.status,'matches');assert.equal(row.referenceResolution.original,INVALID);assert.equal(row.referenceResolution.note,'Conferido no cartão CNPJ');
 assert.ok(one("SELECT id FROM audit WHERE demand_id='reference' AND action LIKE 'Referência do chamado definida%Conferido no cartão CNPJ%'"));
 assert.equal(one("SELECT author FROM processing_resolutions WHERE demand_id='reference'").author,'u');
 run("UPDATE glpi_tickets SET payload=json_set(payload,'$.content',?) WHERE external_id='reference'",'<p>RAZÃO SOCIAL: Escola Teste Ltda</p><p>CNPJ: 11.444.777/0001-63</p>');
 assert.equal(buildProcessingPlan('reference')!.comparisons.find((c:any)=>c.field==='cnpj').status,'ambiguous','referência nova exige nova decisão');
 assert.equal((await post('reference',{revision:revision('reference'),kind:'reference',field:'razaoSocial',value:'Outra',note:'Não está pendente'})).status,409);
});
test('Validação: conferência registrada tira o bloqueio; valor novo volta a bloquear',async()=>{
 const OTHER='22.333.444/0001-81';
 demand('validation',[{id:'1',name:'Contrato.pdf'},{id:'2',name:'Aditivo.pdf'}]);
 file('validation','1','Contrato.pdf',contract);
 file('validation','2','Aditivo.pdf',{text:'CNPJ '+OTHER,fields:{cnpj:[OTHER]},digitalFields:{cnpj:[OTHER]}});
 run("UPDATE contract_processing SET status='Aguardando análise' WHERE demand_id='validation'");
 assert.ok(buildProcessingPlan('validation')!.issues.some((i:any)=>i.field==='review:validation:cnpj'));
 const saved=await post('validation',{revision:revision('validation'),kind:'validation',field:'cnpj',note:'Filial da mesma organização, conferida'});
 assert.equal(saved.status,200,await saved.clone().text());
 const plan=buildProcessingPlan('validation')!;
 assert.ok(!plan.issues.some((i:any)=>i.field==='review:validation:cnpj'));
 assert.equal(plan.validationFindings.find((f:any)=>f.field==='cnpj')!.resolution!.note,'Filial da mesma organização, conferida');
 assert.ok(one("SELECT id FROM audit WHERE demand_id='validation' AND action LIKE 'Achado de validação conferido%'"));
 const THIRD='33.444.555/0001-81';
 run("UPDATE processing_files SET extracted=? WHERE id='validation-2'",JSON.stringify({version:4,text:'CNPJ '+THIRD,fields:{cnpj:[THIRD]},digitalFields:{cnpj:[THIRD]},problem:'',method:'Texto do PDF',pages:1,needsReview:false}));
 assert.ok(buildProcessingPlan('validation')!.issues.some((i:any)=>i.field==='review:validation:cnpj'),'valor diferente exige nova conferência');
});
