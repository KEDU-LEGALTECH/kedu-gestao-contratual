import {test} from 'node:test';
import assert from 'node:assert/strict';
import {combineOcrFields,paddleFields,type OcrBox} from '../server/paddle-ocr.js';
import {readingFilename} from '../server/reading-format.js';
import {readingPdf} from './reading-fixtures.js';
const box=(text:string,x:number,y:number,confidence=99):OcrBox=>({text,confidence,box:[x,y,x+120,y+18]});
test('caixas cadastrais associam nome e bairro sem incorporar o campo vizinho',()=>{
 const result=paddleFields([box('CADASTRO NACIONAL DA PESSOA JURÍDICA',0,0),box('NOME EMPRESARIAL',0,50),box('EMPRESA TESTE',0,65),box('PORTE',600,72),box('ME',600,87),box('CEP',0,150),box('BAIRRO/DISTRITO',200,150),box('MUNICÍPIO',500,150),box('UF',750,150),box('57040-240',0,166),box('JACINTINHO',200,166),box('MACEIÓ',500,166),box('AL',750,166)]);
 assert.deepEqual(result.fields.razaoSocial,['EMPRESA TESTE']);assert.deepEqual(result.fields.bairro,['JACINTINHO']);assert.deepEqual(result.fields.cidade,['MACEIÓ']);
});
test('duas versões precisam concordar antes de acrescentar campos de PaddleOCR',()=>{
 const first=[box('CNPJ: 11.444.777/0001-61',0,0)],second=[box('CNPJ: 11.444.777/0001-62',0,0)];
 assert.deepEqual(combineOcrFields({},[],{passes:[first,second],operations:[],engine:'test'}).fields,{});
 const agreed=combineOcrFields({},[],{passes:[first,first],operations:[],engine:'test'});
 assert.deepEqual(agreed.fields.cnpj,['11.444.777/0001-61']);assert.ok(agreed.verifiedFields.includes('cnpj'));
});
test('conflito entre leitores preserva ambas as leituras sem confirmação automática',()=>{
 const boxes=[box('RAZÃO SOCIAL:',0,0),box('EMPRESA NOVA',0,25)];
 const result=combineOcrFields({razaoSocial:['EMPRESA ANTIGA']},['razaoSocial'],{passes:[boxes,boxes],operations:[],engine:'test'});
 assert.deepEqual(result.fields.razaoSocial,['EMPRESA ANTIGA','EMPRESA NOVA']);assert.ok(!result.verifiedFields.includes('razaoSocial'));
});
test('confiança moderada não vira confirmação só por concordância',()=>{
 const boxes=[box('CNPJ: 11.444.777/0001-61',0,0,82)];
 const result=combineOcrFields({},[],{passes:[boxes,boxes],operations:[],engine:'test'});assert.ok(!result.verifiedFields.includes('cnpj'));
});
test('formato é identificado pelo conteúdo e IMG desconhecido não é presumido imagem',()=>{
 assert.equal(readingFilename(readingPdf(),'documento.img'),'conteudo.pdf');
 assert.equal(readingFilename(Buffer.from('imagem de disco'),'arquivo.img'),'arquivo.img');
});
