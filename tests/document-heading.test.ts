import {test} from 'node:test';
import assert from 'node:assert/strict';
import {headingType,identifyDocumentHeading} from '../shared/document-heading.js';
test('Tipo é identificado no início do título GLPI e no cabeçalho do documento',()=>{
 assert.equal(headingType('JURIDICO : SOLICITAÇÃO DE ADITIVO DE CONTRATO PARA ESCOLAS'),'Aditivo');
 assert.equal(headingType('TERMO DE PARCELAMENTO DE DÉBITOS'),'Parcelamento');
 assert.equal(identifyDocumentHeading('arquivo.pdf','Kedu\nCONTRATO DE PRESTAÇÃO DE SERVIÇOS EDUCACIONAIS\nCONTRATANTE').type,'Contrato educacional');
 assert.equal(identifyDocumentHeading('arquivo.docx','SEGUNDO ADITIVO AO CONTRATO DE GESTÃO').type,'Aditivo');
});
test('Nome do arquivo é fallback e menções no corpo não são tratadas como título',()=>{
 assert.equal(identifyDocumentHeading('Aditivo_Vigencia.docx','Texto sem título').source,'Nome do arquivo');
 assert.equal(identifyDocumentHeading('anexo.png','O cliente pede um aditivo no futuro').type,'');
 assert.equal(identifyDocumentHeading('anexo.pdf',Array.from({length:11},()=> 'Texto do corpo').join('\n')+'\nDISTRATO').type,'');
 assert.equal(identifyDocumentHeading('arquivo.pdf','CONTRATO DE PRESTAÇÃO DE SERVIÇOS').type,'Contrato de prestação de serviços');
 assert.equal(identifyDocumentHeading('Modelo - CONTRATO KEDU.pdf','CONTRATO DE PRESTAÇÃO DE SERVIÇO DE BUFFET').type,'Contrato de prestação de serviço de buffet');
 assert.equal(identifyDocumentHeading('simulacao.png','Parcelamentos contratados\nPrimeiro desconto 05/12/2026').type,'');
});
