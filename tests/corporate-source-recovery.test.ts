import {test} from 'node:test';
import assert from 'node:assert/strict';
import {contextualLayoutFields} from '../server/contextual-layout-fields.js';
import {recoverTextFields} from '../server/text-recovery.js';

// Synthetic fixture reproducing a corporate-seat clause; no real identifiers.
test('corporate seat recovers municipality and state after the CEP, not the partner residence',()=>{
 const text='Sócia residente na Rua Particular, 9, Belém, Estado do Pará.\nA empresa girará sob o nome empresarial. ESCOLA EXEMPLO LTDA.\nE Tem sua sede na na Rua da Escola, Nº 260, CEP 68746-025, Bairro Centro, Município de Castanhal, Estado do Pará.\nFica eleito o foro de Belém.';
 const fields=contextualLayoutFields(text);
 assert.deepEqual(fields.cidade,['Castanhal']);
 assert.deepEqual(fields.estado,['Estado do Pará']);
 assert.equal(contextualLayoutFields('Sócia residente na Rua da Escola, 260, Município de Castanhal, Estado do Pará. Foro da comarca de Belém.').cidade,undefined);
});

test('unquoted legal-name clause is recovered without adopting a trade name',()=>{
 const text='Cláusula Primeira: A empresa girará sob o nome empresarial. ESCOLA EXEMPLO EIRELI.\nE Tem sua sede na Rua da Escola, 260.';
 assert.deepEqual(recoverTextFields(text,{}).razaoSocial,['ESCOLA EXEMPLO EIRELI']);
 assert.equal(recoverTextFields('A escola é conhecida como Escola Exemplo. Nome fantasia ESCOLA EXEMPLO.',{}).razaoSocial,undefined);
 assert.equal(recoverTextFields(text,{razaoSocial:['OUTRA EMPRESA LTDA']}).razaoSocial,undefined);
});

test('sede e domicilio supplies city and UF without using the residential or court location',()=>{
 const text='Sócia residente em São Paulo-SP.\nCLÁUSULA SEGUNDA. A Empresa terá sede e domicílio na Rua DR CELESTINO, 40 – CENTRO - ITAGUAI - RJ, Cep: 23.815-550, e seu foro é na cidade de São Paulo.';
 const fields=contextualLayoutFields(text);
 assert.deepEqual(fields.cidade,['ITAGUAI']);
 assert.deepEqual(fields.estado,['Estado do Rio de Janeiro']);
});

test('unknown state names and conflicting seat locations are not silently adopted',()=>{
 assert.equal(contextualLayoutFields('A empresa tem sede na Rua Um, 10, CEP 11111-111, Município de Cidade Exemplo, Estado de Neverland.').estado,undefined);
 const seats='A empresa tem sede na Rua Um, 10, CEP 11111-111, Município de Castanhal, Estado do Pará.\nA empresa tem sede na Rua Dois, 20, CEP 22222-222, Município de Belém, Estado do Pará.';
 assert.equal(contextualLayoutFields(seats).cidade,undefined);
});

test('company qualification recovers legal name before trade name and address without using GLPI',()=>{
 const text='Pelo presente instrumento, de outro lado, a empresa EMPRESA EXEMPLO ME, com nome fantasia MARCA EXEMPLO, com sede na Rua Um, 10, inscrita no CNPJ 11.444.777/0001-61, neste ato representada por seu administrador.';
 const fields=recoverTextFields(text,{});
 assert.deepEqual(fields.razaoSocial,['EMPRESA EXEMPLO ME']);
 assert.deepEqual(fields.nomeFantasia,['MARCA EXEMPLO']);
});
