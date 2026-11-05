import {test} from 'node:test';import assert from 'node:assert/strict';
import {bankFields} from '../server/bank-reading.js';
import {documentSourceKind,missingFieldEvidence} from '../server/document-evidence.js';
import {sameFieldValue} from '../shared/value-comparison.js';
const text='Sicredi\nAssociado: EMPRESA EXEMPLO LTDA\nCooperativa: 0810\nConta: 12345-8';
test('Sicredi card associates holder, bank and account without inventing agency or tax ID',()=>{
 const fields=bankFields(text);assert.deepEqual(fields.banco,['Sicredi']);assert.deepEqual(fields.titularConta,['EMPRESA EXEMPLO LTDA']);assert.deepEqual(fields.conta,['12345-8']);assert.equal(fields.agencia,undefined);assert.equal(fields.documentoTitular,undefined);
 assert.equal(documentSourceKind({name:'WhatsApp.jpeg',text}),'bank');
 assert.equal(missingFieldEvidence('documentoTitular',[{name:'WhatsApp.jpeg',text}]).reason,'not_located');
 assert.deepEqual(bankFields('Sicredi\nCooperativa: 0810'),{});
});
test('unambiguous bank reference abbreviation keeps numeric/name equivalence narrow',()=>{
 assert.equal(sameFieldValue('banco','Sicred','Sicredi'),true);
 assert.equal(sameFieldValue('banco','Sicred','Sicoob'),false);
 assert.equal(sameFieldValue('banco','Sicred outra empresa','Sicredi'),false);
});
test('account declaration in a social annex keeps the owner apart from its legal representative',()=>{
 const fields=bankFields('Autorizar a movimentação bancária da conta empresarial da pessoa jurídica EMPRESA EXEMPLO LTDA, de n.º 75.625-3, Ag. 3245-X, Banco do Brasil, pela inventariante PESSOA EXEMPLO.');
 assert.deepEqual(fields.titularConta,['EMPRESA EXEMPLO LTDA']);assert.deepEqual(fields.banco,['Banco do Brasil']);assert.deepEqual(fields.agencia,['3245-X']);assert.deepEqual(fields.conta,['75625-3']);assert.equal(fields.documentoTitular,undefined);
 assert.equal(bankFields('A administradora pode movimentar as contas bancárias da empresa.').titularConta,undefined);
});

