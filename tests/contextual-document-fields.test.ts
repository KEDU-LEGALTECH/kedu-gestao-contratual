import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recoverTextFields} from '../server/text-recovery.js';
import {bankFields} from '../server/bank-reading.js';
import {automaticReadingCheck} from '../server/reading-policy.js';
import {requestExpectations,requestCompanyReferences} from '../server/request-expectations.js';
import {fullStateName} from '../shared/state-name.js';
import {plausibleFieldValue} from '../server/field-plausibility.js';
import {readProcessingFile} from '../server/file-reading.js';
test('leitor aplica a recuperação contextual antes de devolver dados estruturados',async()=>{
 const text='A sociedade terá sua sede na Rua Marcos Barbosa, nº 291, Bairro Centro, Mamanguape, PB, CEP 58.280-000.';
 const reading=await readProcessingFile(Buffer.from(text),'social.txt');
 assert.deepEqual(reading.fields.cep,['58280-000']);assert.deepEqual(reading.fields.cidade,['Mamanguape']);
 assert.deepEqual(reading.fields.estado,['Estado da Paraíba']);assert.deepEqual(reading.digitalFields?.cep,['58280-000']);
});
test('estado por extenso também aceita nomes longos',()=>{
 assert.equal(fullStateName('PB'),'Estado da Paraíba');
 assert.equal(plausibleFieldValue('estado',fullStateName('RN')!),true);
 assert.equal(plausibleFieldValue('estado',fullStateName('MS')!),true);
});
test('sede fornece CEP, cidade e estado sem usar o endereço residencial ou inventar nome fantasia',()=>{
 const text='Sócia residente na Rua Particular, 1, Araruna, PB, CEP 58.233-000.\nA sociedade girará sob o nome empresarial “Instituto Miró de Ensino Ltda”.\nA sociedade terá sua sede na Rua Marcos Barbosa, nº 291, Bairro Centro,\nMamanguape, PB, CEP 58.280-000.';
 const r=recoverTextFields(text,{});
 assert.deepEqual(r.cep,['58280-000']);assert.deepEqual(r.cidade,['Mamanguape']);assert.deepEqual(r.estado,['Estado da Paraíba']);
 assert.equal(r.nomeFantasia,undefined);assert.equal(r.titularConta,undefined);assert.equal(r.cnpj,undefined);
 assert.deepEqual(recoverTextFields(text,{cep:['00000-000']}).cep,undefined,'dados existentes não são substituídos');
});
test('CNPJ do titular vem de Dados bancários; chave Pix e CPF pessoal não são titularidade',()=>{
 const text='CPF pessoal: 071.481.154-85\nChaves Pix\nCNPJ\n26.883.390/0001-89\nDados bancários Copiar todos\nCNPJ\n53.258.260/0001-28\nBanco\nMercado Pago\nAgência\n0001\nConta\n8390200873-8';
 const fields=bankFields(text);assert.deepEqual(fields.documentoTitular,['53.258.260/0001-28']);assert.equal(fields.titularConta,undefined);
 assert.equal(bankFields('Chaves Pix\nCNPJ\n53.258.260/0001-28').documentoTitular,undefined);
 assert.equal(bankFields('Dados bancários\nPagador\nCNPJ\n53.258.260/0001-28').documentoTitular,undefined);
 assert.equal(automaticReadingCheck({text,pages:1,method:'OCR de imagem',fields:{documentoTitular:fields.documentoTitular}},'bank',{documentoTitular:['53.258.260/0001-28']}),true);
 assert.equal(automaticReadingCheck({text,pages:1,method:'OCR de imagem',fields:{documentoTitular:fields.documentoTitular}},'bank',{documentoTitular:['26.883.390/0001-89']}),false);
});
test('CNPJs com identificação de empresas são referências separadas',()=>{
 const content='<p>CNPJ: 53.258.260/0001-28 (Miró Colégio); 26.883.390/0001-89 (Instituto Polaris Mamanguape LTDA)</p>';
 assert.deepEqual(requestExpectations(content).cnpj,['53.258.260/0001-28','26.883.390/0001-89']);
 assert.deepEqual(requestCompanyReferences(content),[{cnpj:'53.258.260/0001-28',name:'Miró Colégio'},{cnpj:'26.883.390/0001-89',name:'Instituto Polaris Mamanguape LTDA'}]);
});
