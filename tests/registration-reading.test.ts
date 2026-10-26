import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registrationFieldsFromLines,validCnpj} from '../server/registration-reading.js';
import {fieldsFromLines} from '../server/processing-extract.js';
import {sameRequestedValue} from '../server/request-expectations.js';
const word=(text:string,x:number)=>({text,confidence:96,bbox:{x0:x,y0:0,x1:x+50,y1:15}});
const line=(words:ReturnType<typeof word>[],y:number)=>({text:words.map(w=>w.text).join(' '),words,bbox:{x0:words[0].bbox.x0,y0:y,x1:1000,y1:y+15}});
test('layout cadastral associa valores às colunas sem misturar bairro e município',()=>{
 const fields=registrationFieldsFromLines([line([word('CEP',0),word('BAIRRO/DISTRITO',200),word('MUNICÍPIO',500),word('UF',900)],0),line([word('57.040-240',0),word('JACINTINHO',200),word('MACEIO',500),word('AL',900)],25)]);
 assert.deepEqual(Object.fromEntries(fields.map(f=>[f.key,f.value])),{cep:'57040-240',bairro:'JACINTINHO',cidade:'MACEIO',estado:'AL'});
});
test('CNPJ precisa dos dígitos verificadores, nunca corrige números por aproximação',()=>{
 assert.equal(validCnpj('24.745.095/0001-30'),true);assert.equal(validCnpj('24.745.095/0001-31'),false);assert.equal(validCnpj('00000000000000'),false);
});
test('imagem bancária usa titular explícito e não inventa seu CNPJ',()=>{
 const fields=fieldsFromLines(['Aplicativo Santander Empresas','EMPRESA DE TESTE Agência: 4538 Conta: 130090993']);
 assert.deepEqual(fields.titularConta,['EMPRESA DE TESTE']);assert.deepEqual(fields.banco,['Banco Santander']);assert.equal(fields.documentoTitular,undefined);
});
test('abreviações de endereço e UF não provocam divergências de formato',()=>{
 assert.equal(sameRequestedValue('endereco','AV CANADA, 49A, JACINTINHO','Avenida Canada, 49A, Jacintinho'),true);
 assert.equal(sameRequestedValue('estado','AL','Alagoas'),true);
 assert.equal(sameRequestedValue('estado','AL','Amazonas'),false);
 assert.equal(sameRequestedValue('endereco','AV CANADA, 49A, JACINTINHO','Avenida Canada, 49B, Jacintinho'),false);
});
