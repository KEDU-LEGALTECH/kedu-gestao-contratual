import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pendingReason} from '../shared/pending-reason.js';
import {missingFieldEvidence} from '../server/document-evidence.js';
import {processingStatus} from '../server/processing-status.js';
test('separa ausência, download, página parcial, falha do leitor e campo não associado',()=>{
 const cases:[any[],string][]=[
  [[], 'not_sent'],
  [[{name:'Cartão CNPJ.pdf',downloadFailed:true}], 'download_failed'],
  [[{name:'foto.jpg',downloadFailed:true}], 'download_failed'],
  [[{name:'Cartão CNPJ.pdf',downloadPending:true}], 'download_pending'],
  [[{name:'Cartão CNPJ.pdf',incomplete:true}], 'partial'],
  [[{name:'Cartão CNPJ.pdf',problem:'OCR falhou'}], 'read_failed'],
  [[{name:'Cartão CNPJ.pdf',text:'Texto extraído'}], 'not_located'],
  [[{name:'foto.jpg',text:'Texto extraído'}], 'source_unidentified'],
 ];
 for(const [files,expected] of cases){
  const evidence=missingFieldEvidence('cnpj',files);
  assert.equal(evidence.reason,expected);
  const reason=pendingReason({status:'missing',missingReason:evidence.reason,expectedDocument:evidence.expectedDocument});
  assert.equal(reason?.code,expected);assert.ok(reason?.action);
  assert.equal(processingStatus([],[{status:'missing'}]),'Aguardando análise');
 }
});
test('confirmação tem ação própria e campos corretos ou divergentes não viram falha de leitura',()=>{
 assert.equal(pendingReason({status:'review'})?.label,'Valor aguardando confirmação');
 assert.equal(pendingReason({status:'review',reviewReason:{code:'partial_source'}})?.label,'Página não lida');
 assert.equal(pendingReason({status:'matches'}),undefined);
 assert.equal(pendingReason({status:'different'}),undefined);
});
