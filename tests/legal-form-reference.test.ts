import {test} from 'node:test';
import assert from 'node:assert/strict';
import {legalFormReferenceNeedsReview,referenceTradeNameNeedsReview} from '../server/comparison-evidence.js';

test('possible typo in the reference legal form requires review, never normalization or document correction',()=>{
 assert.equal(legalFormReferenceNeedsReview('razaoSocial',['ESCOLA EXEMPLO EIRELI'],['ESCOLA EXEMPLO EIRELLI']),true);
 assert.equal(legalFormReferenceNeedsReview('razaoSocial',['ESCOLA EXEMPLO LTDA'],['ESCOLA DIFERENTE LTDA']),false);
 assert.equal(legalFormReferenceNeedsReview('razaoSocial',['ESCOLA EXEMPLO LTDA'],['ESCOLA EXEMPLO EIRELI']),false);
 assert.equal(legalFormReferenceNeedsReview('razaoSocial',['ESCOLA EXEMPLO EIRELI'],['ESCOLA EXEMPLO EIRELI']),false);
 assert.equal(legalFormReferenceNeedsReview('nomeFantasia',['ESCOLA EXEMPLO ME'],['ESCOLA EXEMPLO MEE']),false);
 assert.equal(legalFormReferenceNeedsReview('razaoSocial',['ESCOLA EXEMPLO EIRELI','OUTRA EMPRESA LTDA'],['ESCOLA EXEMPLO EIRELLI']),false);
});

test('a trade-name reference for the same documented CNPJ is reviewed, not treated as a different legal entity',()=>{
 const fields={cnpj:['11.444.777/0001-61'],razaoSocial:['EMPRESA EXEMPLO ME'],nomeFantasia:['MARCA EXEMPLO AMBIENTAL']};
 assert.equal(referenceTradeNameNeedsReview('razaoSocial',['EMPRESA EXEMPLO ME'],['MARCA'],['11.444.777/0001-61'],fields),true);
 assert.equal(referenceTradeNameNeedsReview('razaoSocial',['EMPRESA EXEMPLO ME'],['OUTRA MARCA'],['11.444.777/0001-61'],fields),false);
 assert.equal(referenceTradeNameNeedsReview('razaoSocial',['EMPRESA EXEMPLO ME'],['MARCA'],['05.148.852/0001-44'],fields),false);
 assert.equal(referenceTradeNameNeedsReview('razaoSocial',['EMPRESA EXEMPLO ME'],['MARCA'],[],fields),false);
});

test('processing preserves reference typo as review instead of routing the original for correction',async()=>{
 const {mkdtempSync,rmSync}=await import('node:fs');
 const {resolve,join}=await import('node:path');
 const folder=mkdtempSync(resolve('data/test-legal-reference-'));
 process.env.DATABASE_PATH=join(folder,'test.sqlite');process.env.NODE_ENV='test';process.env.DEMO_SEED='false';process.env.GLPI_MODE='demo';
 const { run, now, db, sql } = await import('../server/db.js');
 try{
  const {ensureProcessing,buildProcessingPlan}=await import('../server/contract-processing.js');
  const {processingStatus}=await import('../server/processing-status.js');
  const raw={externalId:'synthetic-reference',title:'Contrato',content:'<p>RAZÃO SOCIAL: ESCOLA EXEMPLO EIRELLI</p>',documents:[{id:'1',name:'Contrato de prestação de serviços.pdf'}],documentsAvailable:true,followups:[],groups:[],status:'2',created:'',updated:'',category:''};
  await sql.run("INSERT INTO demands(id,glpi_id,type,stage,priority,due,data,created) VALUES('synthetic-reference','synthetic-reference','A classificar','Recebido','Normal','','{}',?)", now());
  await sql.run('INSERT INTO glpi_tickets VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', raw.externalId, 'real', raw.title, '2', 'synthetic-hash', JSON.stringify(raw), '{}', 'vinculado', raw.externalId, now(), now(), null);
  await ensureProcessing(raw.externalId);
  const reading={text:'CONTRATO DE PRESTAÇÃO DE SERVIÇOS\nCONTRATANTE: ESCOLA EXEMPLO EIRELI.',fields:{razaoSocial:['ESCOLA EXEMPLO EIRELI']},method:'Texto do PDF',pages:1,needsReview:false,incomplete:false};
  await sql.run('INSERT INTO processing_files VALUES(?,?,?,?,?,?,?,?,?,?)', 'synthetic-file', raw.externalId, '1', 'synthetic-hash', 'Contrato de prestação de serviços.pdf', 'application/pdf', Buffer.from('synthetic fixture'), JSON.stringify(reading), '', now());
  const plan=(await buildProcessingPlan(raw.externalId))!;
  const field=plan.comparisons.find(c=>c.field==='razaoSocial')!;
  assert.equal(field.status,'review');
  assert.equal(field.reviewReason?.code,'reference_name_typo');
  assert.equal(field.found,'ESCOLA EXEMPLO EIRELI');assert.equal(field.expected,'ESCOLA EXEMPLO EIRELLI');
  assert.equal(processingStatus(plan.issues,plan.comparisons),'Aguardando análise');
  raw.content='<p>RAZÃO SOCIAL: MARCA</p><p>CNPJ: 11.444.777/0001-61</p>';
  await sql.run('UPDATE glpi_tickets SET payload=? WHERE external_id=?', JSON.stringify(raw), raw.externalId);
  const brandReading={...reading,text:'a empresa EMPRESA EXEMPLO ME, com nome fantasia MARCA EXEMPLO AMBIENTAL, inscrita no CNPJ 11.444.777/0001-61.',fields:{razaoSocial:['EMPRESA EXEMPLO ME'],cnpj:['45.543.580/0001-00'],nomeFantasia:['MARCA EXEMPLO AMBIENTAL']}};
  await sql.run('UPDATE processing_files SET extracted=? WHERE id=?', JSON.stringify(brandReading), 'synthetic-file');
  const brandPlan=(await buildProcessingPlan(raw.externalId))!,brandField=brandPlan.comparisons.find(c=>c.field==='razaoSocial')!;
  assert.equal(brandField.status,'review');assert.equal(brandField.reviewReason?.code,'reference_trade_name');
  assert.equal(processingStatus(brandPlan.issues,brandPlan.comparisons),'Aguardando análise');
  assert.doesNotMatch(brandPlan.issues.find(i=>i.field==='razaoSocial')?.message||'',/Corrija o valor/);
 }finally{if(sql.dialect==='sqlite')db.close();rmSync(folder,{recursive:true,force:true});}
});
