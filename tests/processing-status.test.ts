import {test} from 'node:test';
import assert from 'node:assert/strict';
import {processingStatus} from '../server/processing-status.js';
import {fieldsFromLines} from '../server/processing-extract.js';
import {complementaryOcrFields} from '../server/reading-policy.js';
test('alternate OCR recovers omitted labels without replacing conflicts or trusting low confidence',()=>{
 assert.deepEqual(complementaryOcrFields({cidade:['Maceió']},{cidade:['Recife'],cnpj:['24.745.095/0001-30']},90),{cnpj:['24.745.095/0001-30']});
 assert.deepEqual(complementaryOcrFields({},{cnpj:['24.745.095/0001-30']},40),{});
 assert.deepEqual(complementaryOcrFields({},{cnpj:['A','B']},90),{});
});
test('only confirmed differences require correction; missing readings and administration stay separate',()=>{
 assert.equal(processingStatus([{field:'templateApproval'}],[{status:'matches'}]),'Sem erros');
 assert.equal(processingStatus([{field:'template'}],[{status:'matches'}]),'Sem erros');
 assert.equal(processingStatus([],[{status:'ambiguous'}]),'Aguardando análise');
 assert.equal(processingStatus([{field:'cnpj'}],[{status:'missing'}]),'Aguardando análise');
 assert.equal(processingStatus([],[{status:'different',readingPending:true}]),'Aguardando análise');
 assert.equal(processingStatus([{field:'review:another'}],[{status:'different',readingPending:false}]),'Aguardando correção');
 assert.equal(processingStatus([{field:'processing'}],[]),'Aguardando análise');
 assert.equal(processingStatus([],[]),'Aguardando análise');
 assert.equal(processingStatus([],[{status:'matches'}]),'Sem erros');
});
test('registration labels and OCR table separators retain document evidence',()=>{
 const fields=fieldsFromLines(['TÍTULO DO ESTABELECIMENTO (NOME DE FANTASIA)','Escolinha Pequenos Passos','MUNICÍPIO | Maceió','CNPJ Nº: 24.745.095/0001-30']);
 assert.deepEqual(fields.nomeFantasia,['Escolinha Pequenos Passos']);
 assert.deepEqual(fields.cidade,['Maceió']);
 assert.deepEqual(fields.cnpj,['24.745.095/0001-30']);
 assert.equal(fields.razaoSocial,undefined);
});
