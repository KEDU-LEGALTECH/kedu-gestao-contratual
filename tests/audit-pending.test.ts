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
const {buildProcessingPlan,ensureProcessing,scheduleContractProcessing,processContract,processingFileProgress,processingSummary}=await import('../server/contract-processing.js');
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
async function demand(id:string,documents:any[],{cnpj=VALID,status='2',coverage={}}:{cnpj?:string;status?:string;coverage?:any}={}){
 const raw={externalId:id,title:'JURIDICO : SOLICITAÇÃO DE CONTRATO PARA ESCOLAS',status,content:`<p>RAZÃO SOCIAL: Escola Teste Ltda</p><p>CNPJ: ${cnpj}</p>`,followups:[],documents,documentsAvailable:true,...coverage};
 run("INSERT INTO demands(id,glpi_id,school_id,type,stage,priority,owner,due,data,created) VALUES(?,?,?,'Contrato de garantia','Recebido','Normal','u','','{}',?)",id,id,'s',now());
 run('INSERT INTO glpi_tickets VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',id,'real',raw.title,status,'hash-'+id,JSON.stringify(raw),'{}','vinculado',id,now(),now(),null);
 await ensureProcessing(id);
}
function file(did:string,documentId:string,name:string,reading:any,problem=''){
 const extracted={version:4,text:'',fields:{},problem,method:'Texto do PDF',pages:1,needsReview:false,...reading};
 run('INSERT INTO processing_files VALUES(?,?,?,?,?,?,?,?,?,?)',did+'-'+documentId,did,documentId,'hash-'+did,name,'application/pdf',Buffer.from('conteudo '+documentId),JSON.stringify(extracted),problem,now());
}
const contract={text:'CONTRATO DE PRESTAÇÃO DE SERVIÇOS\nCONTRATADA: Escola Teste Ltda, inscrita no CNPJ '+VALID,fields:{razaoSocial:['Escola Teste Ltda'],cnpj:[VALID]},digitalFields:{razaoSocial:['Escola Teste Ltda'],cnpj:[VALID]}};
const ocrPhoto={text:'Foto de uma reunião, sem dados cadastrais.',method:'OCR de imagem',needsReview:true,confidence:90};

test('CNPJ da contratada compara os 14 dígitos quando há evidência da parte',async ()=>{
 const invalid='11.444.777/0001-62';
 const text=`CONTRATO DE PRESTAÇÃO DE SERVIÇOS
CONTRATANTE: KEDU LTDA, inscrita no CNPJ 45.543.580/0001-00.
CONTRATADA: Escola Teste Ltda, inscrita no CNPJ ${invalid}.
AGENTE: Outra Empresa Ltda, inscrita no CNPJ 05.868.278/0001-07.`;
 for(const [id,expected,status] of [['printed-invalid-reference',invalid,'matches'],['printed-invalid-document',VALID,'review'],['printed-invalid-ocr',invalid,'ambiguous']]){
  await demand(id,[{id:'1',name:'Contrato.docx'}],{cnpj:expected});
  const uncertain=id==='printed-invalid-ocr';
  file(id,'1','Contrato.docx',{text,method:uncertain?'DOCX com OCR':'DOCX',needsReview:uncertain});
  const plan=(await buildProcessingPlan(id))!;
  const row=plan.comparisons.find(c=>c.field==='cnpj')!;
  assert.equal(row.found,invalid);
  assert.equal(row.status,status);
  assert.equal(pendingReason(row)?.code,status==='matches'?undefined:'invalid_identifier');
  assert.match(row.evidence[0].excerpt,/Escola Teste Ltda/);
  assert.equal(plan.issues.some(i=>i.field.startsWith('review:parties:')),false);
  assert.equal(processingStatus(plan.issues,plan.comparisons,true),status==='matches'?'Sem erros':'Conferência parcial');
 }
 await demand('printed-invalid-other-party',[{id:'1',name:'Contrato.docx'}],{cnpj:invalid});
 file('printed-invalid-other-party','1','Contrato.docx',{text:text.replace('CONTRATADA: Escola Teste Ltda','CONTRATADA: Outra Escola Ltda'),method:'DOCX'});
 assert.equal((await buildProcessingPlan('printed-invalid-other-party'))!.comparisons.find(c=>c.field==='cnpj')?.status,'ambiguous');
});

test('Conferência contratual: apoio com valores iguais não substitui o contrato',async ()=>{
 await demand('only-support',[{id:'1',name:'Contrato social.pdf'}]);
 file('only-support','1','Contrato social.pdf',{...contract,text:'CONTRATO SOCIAL\n'+contract.text});
 const plan=(await buildProcessingPlan('only-support'))!;
 assert.equal(plan.issues.find(i=>i.field==='contractMissing')?.label,'Contrato não encontrado');
 assert.equal(plan.comparisons.length,0);
 assert.equal(plan.files[0].contractForComparison,false);
});

test('Conferência contratual: só o contrato fornece valores para a comparação',async ()=>{
 await demand('contract-and-support',[{id:'1',name:'instrumento.pdf'},{id:'2',name:'Cartão CNPJ.pdf'}]);
 file('contract-and-support','1','instrumento.pdf',contract);
 file('contract-and-support','2','Cartão CNPJ.pdf',{...contract,text:'CARTÃO CNPJ\n'+contract.text,fields:{...contract.fields,razaoSocial:['Outra Empresa Ltda']}});
 const plan=(await buildProcessingPlan('contract-and-support'))!;
 assert.deepEqual(plan.files.filter(f=>f.contractForComparison).map(f=>f.name),['instrumento.pdf']);
 assert.equal(plan.comparisons.find(c=>c.field==='razaoSocial')?.status,'matches');
 assert.equal(plan.comparisons.find(c=>c.field==='cnpj')?.status,'matches');
});

test('Conferência contratual: contrato não obtido é diferente de contrato não encontrado',async ()=>{
 await demand('contract-pending',[{id:'1',name:'1º Termo Aditivo.pdf'}]);
 const plan=(await buildProcessingPlan('contract-pending'))!;
 assert.equal(plan.issues.find(i=>i.field==='file:1')?.label,'Contrato não lido');
 assert.ok(!plan.issues.some(i=>i.field==='contractMissing'));
});

test('Fila contratual: planilha e aditivo societário ficam disponíveis sem download automático',async()=>{
 const id='support-outside-queue';
 await demand(id,[{id:'1',name:'Proposta de Adiantamento.xlsx'},{id:'2',name:'9º Aditivo ao Contrato Social.pdf'},{id:'3',name:'Termo Anexo.pdf'}]);
 file(id,'3','Termo Anexo.pdf',{text:'ANEXO I - Demonstrativo de Antecipação'});
 await processContract(id,null,async()=>{assert.fail('Anexo de apoio não deve ser baixado pela fila');});
 const plan=(await buildProcessingPlan(id))!;
 assert.equal(plan.issues.find(i=>i.field==='contractMissing')?.label,'Contrato não encontrado');
 assert.equal(plan.files.length,1);
 const progress=await processingFileProgress(id);
 assert.deepEqual(progress.files.map((f:{state:string})=>f.state),['skipped','skipped','skipped']);
 assert.equal(JSON.parse(one('SELECT payload FROM glpi_tickets WHERE external_id=?',id).payload).documents.length,3);
});

test('Fila contratual: prioriza contrato, identifica genéricos e evita repetir tipo incerto',async()=>{
 const id='scoped-reading-queue';
 await demand(id,[{id:'1',name:'arquivo.txt'},{id:'2',name:'Contrato.txt'},{id:'3',name:'planilha.xlsx'}]);
 const visited:string[]=[];
 const download=async(_ticket:string,doc:string)=>{
  visited.push(doc);
  const text=doc==='2'?contract.text+'\nRAZÃO SOCIAL: Escola Teste Ltda\nCNPJ: '+VALID:'Texto sem identificação do documento.';
  return {bytes:Buffer.from(text),name:doc==='2'?'Contrato.txt':'arquivo.txt',mime:'text/plain'};
 };
 await processContract(id,null,download);
 await processContract(id,null,download);
 assert.deepEqual(visited,['2','1']);
 assert.deepEqual((await processingFileProgress(id)).files.map((f:{state:string})=>f.state),['unidentified','completed','skipped']);
 assert.equal((await buildProcessingPlan(id))!.comparisons.find(c=>c.field==='cnpj')?.status,'matches');
});

test('Fila contratual: arquivo genérico com título de contrato entra na conferência',async()=>{
 const id='generic-contract';
 await demand(id,[{id:'1',name:'arquivo.txt'}]);
 await processContract(id,null,async()=>({bytes:Buffer.from(contract.text+'\nRAZÃO SOCIAL: Escola Teste Ltda\nCNPJ: '+VALID),name:'arquivo.txt',mime:'text/plain'}));
 assert.equal((await buildProcessingPlan(id))!.files[0].contractForComparison,true);
});

test('Qualificação digital separa título do distrato e nome da empresa',async ()=>{
 const id='fused-qualification';
 const name='Escola Teste Ltda';
 const fused='Cláusula Primeira – Do objeto INSTRUMENTO PARTICULAR DE RESCISÃO CONTRATUAL '+name;
 await demand(id,[{id:'1',name:'Distrato.pdf'}]);
 file(id,'1','Distrato.pdf',{text:'INSTRUMENTO PARTICULAR DE RESCISÃO CONTRATUAL '+name+', sociedade, inscrita no CNPJ sob o nº '+VALID,fields:{razaoSocial:[fused],cnpj:[VALID]},digitalFields:{razaoSocial:[fused],cnpj:[VALID]}});
 const row=(await buildProcessingPlan(id))!.comparisons.find(c=>c.field==='razaoSocial');
 assert.equal(row?.found,name);
 assert.equal(row?.status,'matches');
});
test('CNPJ em duas linhas mantém o vínculo com a contratada',async ()=>{
 const id='wrapped-party';
 await demand(id,[{id:'1',name:'Contrato.pdf'}]);
 file(id,'1','Contrato.pdf',{text:'CONTRATO DE PRESTAÇÃO DE SERVIÇOS\nCONTRATADA: Escola Teste Ltda, inscrita no CNPJ sob nº 11.444.777/0001-\n61.\nCONTRATANTE: KEDU, inscrita no CNPJ 45.543.580/0001-00.\nCLÁUSULA PRIMEIRA – OBJETO\nCNPJ da testemunha: 05.868.278/0001-07'});
 const plan=(await buildProcessingPlan(id))!;
 assert.equal(plan.files[0].selectedParty?.name,'Escola Teste Ltda');
 assert.equal(plan.comparisons.find(c=>c.field==='cnpj')?.status,'matches');
});
test('Assinatura da locadora recupera o nome sem usar o CNPJ da locatária',async ()=>{
 const id='rental-signature';
 await demand(id,[{id:'1',name:'Aditivo.pdf'}]);
 file(id,'1','Aditivo.pdf',{text:'ADITIVO DE LOCAÇÃO\nLOCATÁRIO KEDU CNPJ: 45.543.580/0001-00\n____________   ____________\nKEDU SERVIÇOS LTDA   Escola Teste\nLtda\nLOCATÁRIO   LOCADOR\nTestemunhas:'});
 const plan=(await buildProcessingPlan(id))!;
 assert.equal(plan.comparisons.find(c=>c.field==='razaoSocial')?.status,'matches');
 assert.equal(plan.comparisons.find(c=>c.field==='cnpj')?.status,'missing');
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
test('Versão clara: o arquivo antigo fica visível, mas não gera divergência nem pendência',async ()=>{
 const docs=[{id:'1',name:'Contrato escola teste.docx'},{id:'2',name:'Contrato escola teste - Revisado.docx'}];
 await demand('version',docs);
 file('version','1','Contrato escola teste.docx',{text:'CONTRATADA: Outra Escola Ltda',method:'DOCX',fields:{razaoSocial:['Outra Escola Ltda']},digitalFields:{razaoSocial:['Outra Escola Ltda']}});
 file('version','2','Contrato escola teste - Revisado.docx',{...contract,method:'DOCX'});
 const plan=(await buildProcessingPlan('version'))!;
 assert.equal(plan.comparisons.find((c:any)=>c.field==='razaoSocial').status,'matches');
 assert.equal(plan.files.length,2);
 assert.equal(plan.files.find((f:any)=>f.document_id==='1')!.supersededBy,'Contrato escola teste - Revisado.docx');
 assert.equal(plan.files.find((f:any)=>f.document_id==='2')!.supersededBy,undefined);
});
test('Versão sem vínculo claro continua como escolha humana',async ()=>{
 const docs=[{id:'1',name:'Contrato A.docx'},{id:'2',name:'Minuta B.docx'}];
 await demand('no-link',docs);
 file('no-link','1','Contrato A.docx',{text:'CONTRATO DE PRESTAÇÃO DE SERVIÇOS\nRAZÃO SOCIAL: Outra Escola Ltda',method:'DOCX',fields:{razaoSocial:['Outra Escola Ltda']},digitalFields:{razaoSocial:['Outra Escola Ltda']}});
 file('no-link','2','Minuta B.docx',{...contract,method:'DOCX'});
 const row=(await buildProcessingPlan('no-link'))!.comparisons.find((c:any)=>c.field==='razaoSocial');
 assert.equal(row.status,'review');assert.equal(row.reviewReason.code,'conflicting_values');
});
test('Arquivo lido sem campo aproveitado não bloqueia se os campos estão resolvidos, e fica visível',async ()=>{
 await demand('unused',[{id:'1',name:'Contrato.pdf'},{id:'2',name:'foto.jpeg'}]);
 file('unused','1','Contrato.pdf',contract);file('unused','2','foto.jpeg',ocrPhoto);
 const plan=(await buildProcessingPlan('unused'))!;
 assert.ok(plan.comparisons.every((c:any)=>c.status==='matches'),JSON.stringify(plan.comparisons.map((c:any)=>[c.field,c.status])));
 assert.ok(!plan.issues.some((i:any)=>i.field==='review:unused-2'));
 assert.equal(plan.files.find((f:any)=>f.id==='unused-2')!.contractForComparison,false);
 assert.equal(plan.files.find((f:any)=>f.id==='unused-1')!.notUsed,false);
 assert.equal(processingStatus(plan.issues,plan.comparisons),'Sem erros');
 assert.equal(one('SELECT count(*) n FROM processing_file_reviews').n,0,'nenhuma conferência humana é criada');
});
test('Foto de tipo incerto fica fora de novas tentativas automáticas',async ()=>{
 await demand('unused-open',[{id:'2',name:'foto.jpeg'}]);
 file('unused-open','2','foto.jpeg',ocrPhoto);
 const plan=(await buildProcessingPlan('unused-open'))!;
 assert.equal(plan.issues.find(i=>i.field==='file:2')?.label,'Tipo a confirmar');
 assert.equal(processingStatus(plan.issues,plan.comparisons),'Aguardando análise');
});
test('Leitura parcial de um contrato ainda bloqueia a conferência',async ()=>{
 await demand('unused-partial',[{id:'1',name:'Contrato.pdf'},{id:'2',name:'scan.pdf'}]);
 file('unused-partial','1','Contrato.pdf',contract);file('unused-partial','2','scan.pdf',{...ocrPhoto,text:'CONTRATO DE PRESTAÇÃO DE SERVIÇOS',incomplete:true,pendingPages:[2],pages:2});
 const plan=(await buildProcessingPlan('unused-partial'))!;
 assert.ok(plan.issues.some((i:any)=>i.field==='review:partial:unused-partial-2'));
 assert.equal(plan.files.find((f:any)=>f.id==='unused-partial-2')!.notUsed,false);
 assert.equal(processingStatus(plan.issues,plan.comparisons),'Aguardando análise');
});
test('Valor no texto sem associação recebe estado próprio, sem contar como confere',async ()=>{
 const files=[{name:'alteracao.pdf',extracted:JSON.stringify({text:'Sócio identificado pelo número '+VALID+' na cláusula.'})}];
 assert.equal(attachmentWithValue('documentoTitular',VALID,files),'alteracao.pdf');
 assert.equal(attachmentWithValue('documentoTitular','22.333.444/0001-81',files),undefined);
 await demand('unassociated',[{id:'1',name:'Contrato.pdf'}]);
 run("UPDATE glpi_tickets SET payload=json_set(payload,'$.content',?) WHERE external_id='unassociated'",`<p>RAZÃO SOCIAL: Escola Teste Ltda</p><p>CNPJ: ${VALID}</p><p>CPF/CNPJ DO TITULAR: ${VALID}</p>`);
 file('unassociated','1','Contrato.pdf',contract);
 const row=(await buildProcessingPlan('unassociated'))!.comparisons.find((c:any)=>c.field==='documentoTitular');
 assert.equal(row.status,'missing');assert.equal(row.missingReason,'value_unassociated');assert.equal(row.expectedDocument,'Contrato');
 assert.equal(pendingReason(row)!.label,'Valor encontrado sem associação');
});
test('Cobertura incompleta não afirma que o arquivo não foi enviado',async ()=>{
 assert.equal(missingFieldEvidence('cnpj',[]).reason,'not_sent');
 const evidence=missingFieldEvidence('cnpj',[],true);
 assert.equal(evidence.reason,'coverage_partial');assert.doesNotMatch(evidence.message,/não enviado/);
 assert.equal(pendingReason({status:'missing',missingReason:'coverage_partial'})!.label,'Cobertura parcial');
 assert.equal(pendingReason({status:'missing',missingReason:'download_pending'})!.label,'Arquivo ainda não importado');
 await demand('coverage',[],{coverage:{approvalCoverage:'partial',timelineCoverage:'complete'}});
 const plan=(await buildProcessingPlan('coverage'))!;
 assert.equal(plan.comparisons.length,0);
 const issue=plan.issues.find(i=>i.field==='contractMissing')!;
 assert.equal(issue.label,'Consulta ao GLPI incompleta');
 assert.equal(issue.missingReason,'coverage_partial');
 run("UPDATE contract_processing SET status='Aguardando análise',result=? WHERE demand_id='coverage'",
  JSON.stringify({issues:[{field:'contractMissing',label:'Contrato não encontrado',message:'Ainda há fontes por consultar.'}]}));
 assert.equal((await processingSummary('coverage'))?.contractStage,'Consulta ao GLPI incompleta');
 await demand('coverage-ok',[],{coverage:{approvalCoverage:'not_required',timelineCoverage:'complete'}});
 assert.equal((await buildProcessingPlan('coverage-ok'))!.issues.find(i=>i.field==='contractMissing')?.label,'Contrato não encontrado');
});
test('Formato sem leitor não é repetido e tem motivo próprio',()=>{
 const problem='Formato sem leitor disponível. O original foi preservado; envie PDF.';
 assert.equal(needsReadingRecovery({byteLength:10,problem,extracted:JSON.stringify({problem})}),false);
 assert.equal(needsReadingRecovery({byteLength:10,problem:'Nenhum texto legível',extracted:JSON.stringify({})}),true);
 assert.equal(pendingReason({field:'file:1',message:problem})!.code,'unsupported');
});
test('Fila reabre leitura presa: concluída na hora e esgotada só uma vez por dia',async ()=>{
 const database=new DatabaseSync(':memory:');
 database.exec("CREATE TABLE reading_jobs(demand_id TEXT,ticket_hash TEXT,state TEXT,attempts INTEGER NOT NULL DEFAULT 0,available_at INTEGER,owner TEXT,updated INTEGER,last_error TEXT NOT NULL DEFAULT '',progress INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(demand_id,ticket_hash))");
 let clock=1000000000;
 const queue=new ReadingJobQueue(database,()=>clock);
 const state=(id:string)=>database.prepare('SELECT state,attempts,last_error FROM reading_jobs WHERE demand_id=?').get(id) as any;
 const put=(id:string,s:string,updated:number)=>database.prepare("INSERT INTO reading_jobs(demand_id,ticket_hash,state,attempts,available_at,updated) VALUES(?,'h',?,3,0,?)").run(id,s,updated);
 put('done','done',clock);put('recent','exhausted',clock-3600000);put('old','exhausted',clock-25*3600000);
 for(const id of ['done','recent','old'])await queue.enqueue(id,'h',false,true);
 assert.equal(state('done').state,'queued');assert.equal(state('done').attempts,0);
 assert.equal(state('recent').state,'exhausted');
 assert.equal(state('old').state,'queued');
 put('quiet','done',clock);await queue.enqueue('quiet','h');
 assert.equal(state('quiet').state,'done','sem recuperação pendente nada muda');
});
test('Chamado encerrado sai da leitura automática, sem perder dados, e volta se for reaberto',async()=>{
 await demand('closed',[{id:'1',name:'Novo.pdf'}],{status:'5'});
 const hash='hash-closed',at=Date.now();
 run("INSERT INTO reading_jobs(demand_id,ticket_hash,state,available_at,updated) VALUES('closed',?,'queued',?,?)",hash,at-1000,at-1000);
 run("UPDATE settings SET value='false' WHERE key='documentReadingPaused'");
 // Only this demand may be scanned: the others in this file are test fixtures.
 const others=all("SELECT external_id FROM glpi_tickets WHERE external_id<>'closed'").map(t=>t.external_id);
 for(const id of others)run("UPDATE demands SET stage='Cancelado' WHERE glpi_id=?",id);
 process.env.NODE_ENV='production';
 try{
  await scheduleContractProcessing();
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
  await scheduleContractProcessing();
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
 await demand('reference',[{id:'1',name:'Contrato.pdf'}],{cnpj:INVALID});file('reference','1','Contrato.pdf',contract);
 run("UPDATE contract_processing SET status='Aguardando análise' WHERE demand_id='reference'");
 const before=(await buildProcessingPlan('reference'))!.comparisons.find((c:any)=>c.field==='cnpj');
 assert.equal(before.status,'ambiguous');
 assert.equal((await post('reference',{revision:revision('reference'),kind:'reference',field:'cnpj',value:INVALID,note:'Conferido no cadastro'})).status,400,'documento inválido é recusado');
 assert.equal((await post('reference',{revision:revision('reference'),kind:'reference',field:'cnpj',value:VALID,note:'x'})).status,400,'justificativa é obrigatória');
 assert.equal((await post('reference',{revision:1000,kind:'reference',field:'cnpj',value:VALID,note:'Conferido no cadastro'})).status,409);
 const saved=await post('reference',{revision:revision('reference'),kind:'reference',field:'cnpj',value:VALID,note:'Conferido no cartão CNPJ'});
 assert.equal(saved.status,200,await saved.clone().text());
 const row=(await buildProcessingPlan('reference'))!.comparisons.find((c:any)=>c.field==='cnpj');
 assert.equal(row.status,'matches');assert.equal(row.referenceResolution.original,INVALID);assert.equal(row.referenceResolution.note,'Conferido no cartão CNPJ');
 assert.ok(one("SELECT id FROM audit WHERE demand_id='reference' AND action LIKE 'Referência do chamado definida%Conferido no cartão CNPJ%'"));
 assert.equal(one("SELECT author FROM processing_resolutions WHERE demand_id='reference'").author,'u');
 run("UPDATE glpi_tickets SET payload=json_set(payload,'$.content',?) WHERE external_id='reference'",'<p>RAZÃO SOCIAL: Escola Teste Ltda</p><p>CNPJ: 11.444.777/0001-63</p>');
 assert.equal((await buildProcessingPlan('reference'))!.comparisons.find((c:any)=>c.field==='cnpj').status,'ambiguous','referência nova exige nova decisão');
 assert.equal((await post('reference',{revision:revision('reference'),kind:'reference',field:'razaoSocial',value:'Outra',note:'Não está pendente'})).status,409);
});
test('Validação: conferência registrada tira o bloqueio; valor novo volta a bloquear',async()=>{
 const OTHER='22.333.444/0001-81';
 await demand('validation',[{id:'1',name:'Contrato.pdf'},{id:'2',name:'Aditivo.pdf'}]);
 file('validation','1','Contrato.pdf',contract);
 file('validation','2','Aditivo.pdf',{text:'TERMO ADITIVO\nCNPJ '+OTHER,fields:{cnpj:[OTHER]},digitalFields:{cnpj:[OTHER]}});
 run("UPDATE contract_processing SET status='Aguardando análise' WHERE demand_id='validation'");
 assert.ok((await buildProcessingPlan('validation'))!.issues.some((i:any)=>i.field==='review:validation:cnpj'));
 const saved=await post('validation',{revision:revision('validation'),kind:'validation',field:'cnpj',note:'Filial da mesma organização, conferida'});
 assert.equal(saved.status,200,await saved.clone().text());
 const plan=(await buildProcessingPlan('validation'))!;
 assert.ok(!plan.issues.some((i:any)=>i.field==='review:validation:cnpj'));
 assert.equal(plan.validationFindings.find((f:any)=>f.field==='cnpj')!.resolution!.note,'Filial da mesma organização, conferida');
 assert.ok(one("SELECT id FROM audit WHERE demand_id='validation' AND action LIKE 'Achado de validação conferido%'"));
 const THIRD='33.444.555/0001-81';
 run("UPDATE processing_files SET extracted=? WHERE id='validation-2'",JSON.stringify({version:4,text:'TERMO ADITIVO\nCNPJ '+THIRD,fields:{cnpj:[THIRD]},digitalFields:{cnpj:[THIRD]},problem:'',method:'Texto do PDF',pages:1,needsReview:false}));
 assert.ok((await buildProcessingPlan('validation'))!.issues.some((i:any)=>i.field==='review:validation:cnpj'),'valor diferente exige nova conferência');
});
test('Triagem contratual: reconhece contratos com prefixo no nome, move anexos não contratuais lidos de Tipo a confirmar para Contrato não encontrado e informa o motivo exato em Contrato não lido',async ()=>{
 // 1. Prefixed contract filenames and signed contract filenames are recognized as contracts, not missed as Contrato não encontrado
 await demand('prefixed-contract',[{id:'1',name:'Colégio Teste - 1º Termo Aditivo.pdf'}]);
 file('prefixed-contract','1','Colégio Teste - 1º Termo Aditivo.pdf',{...contract,text:'Razão social: Escola Teste Ltda\nCNPJ: '+VALID+'\nTaxa de remuneração: 11,84%'});
 const prefixedPlan=(await buildProcessingPlan('prefixed-contract'))!;
 assert.equal(prefixedPlan.files[0].contractForComparison,true);
 assert.ok(!prefixedPlan.issues.some((i:any)=>i.field==='contractMissing'));

 // 2. Non-contract PDF/DOCX already read (e.g. Boleto, Ficha Cadastral, Estatuto, or generic PDF read completely without contract content) moves from Tipo a confirmar to Contrato não encontrado
 await demand('read-non-contract',[{id:'1',name:'documento_escola.pdf'},{id:'2',name:'Boleto_Mensalidade.pdf'}]);
 file('read-non-contract','1','documento_escola.pdf',{text:'Histórico administrativo da instituição de ensino com relação de turmas e horários do ano letivo de 2026.',triageOnly:true});
 file('read-non-contract','2','Boleto_Mensalidade.pdf',{text:'Boleto bancário vencimento 10/11/2026 valor R$ 500,00',triageOnly:true});
 const nonContractPlan=(await buildProcessingPlan('read-non-contract'))!;
 assert.ok(!nonContractPlan.issues.some((i:any)=>i.label==='Tipo a confirmar'));
 assert.equal(nonContractPlan.issues.find((i:any)=>i.field==='contractMissing')?.label,'Contrato não encontrado');

 // 3. Contrato não lido informs the exact cause (e.g. closed GLPI ticket, download failure with HTTP detail, or waiting in queue)
 await demand('unreadable-closed',[{id:'1',name:'Contrato_Garantia.pdf'}],{status:'5'});
 const closedIssue=(await buildProcessingPlan('unreadable-closed'))!.issues.find((i:any)=>i.field==='file:1')!;
 assert.equal(closedIssue.label,'Contrato não lido');
 assert.match(closedIssue.message,/encerrado no GLPI/);

 await demand('unreadable-http',[{id:'1',name:'Contrato_Garantia.pdf'}]);
 run('INSERT INTO processing_files VALUES(?,?,?,?,?,?,?,?,?,?)','unreadable-http-1','unreadable-http','1','hash-unreadable-http','Contrato_Garantia.pdf','application/pdf',Buffer.alloc(0),JSON.stringify({version:4,text:'',fields:{},problem:'Não foi possível baixar o anexo.',failureDetail:'HTTP 403'}),'Não foi possível baixar o anexo.',now());
 const httpIssue=(await buildProcessingPlan('unreadable-http'))!.issues.find((i:any)=>i.field==='file:1')!;
 assert.equal(httpIssue.label,'Contrato não lido');
 assert.match(httpIssue.message,/HTTP 403/);
 assert.equal(httpIssue.pendingReason?.code,'download_failed');
});

