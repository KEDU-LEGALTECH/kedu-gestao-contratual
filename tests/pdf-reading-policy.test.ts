import {test} from 'node:test';
import assert from 'node:assert/strict';
import {needsPdfOcr,pdfPageBudget} from '../server/pdf-reading-policy.js';
test('PDF longo mantém orçamento útil por página em vez de diluir o tempo entre todas',()=>{
 assert.equal(pdfPageBudget(140000),60000);assert.equal(pdfPageBudget(140000,true),70000);
 assert.equal(pdfPageBudget(12000),12000);assert.equal(pdfPageBudget(-1),0);
});
test('digital PDF with small decorative images stays digital; scanned body requires OCR',()=>{
 const codes={save:1,restore:2,transform:3,paintImageXObject:4};
 const text='Texto digital do contrato com informações. '.repeat(20);
 const ops=(scale:number)=>({fnArray:[1,3,4,2],argsArray:[[],[scale,0,0,scale,0,0],[],[]]});
 assert.equal(needsPdfOcr(text,ops(50),codes,600*800),false);
 assert.equal(needsPdfOcr(text,ops(600),codes,600*800),true);
 assert.equal(needsPdfOcr('Cabeçalho',ops(50),codes,600*800),true);
 assert.equal(needsPdfOcr('Registro de assinaturas eletrônicas com nomes e datas selecionáveis. '.repeat(2),ops(50),codes,600*800),false);
 assert.equal(needsPdfOcr('Registro de assinaturas eletrônicas com nomes e datas selecionáveis. '.repeat(2),ops(600),codes,600*800),true);
 assert.equal(needsPdfOcr(text,{fnArray:[3],argsArray:[[NaN]]},codes,600*800),true);
});
test('small repeated logos and masks do not trigger OCR; large and unknown repetitions still do',()=>{
 const codes={save:1,restore:2,transform:3,paintImageXObject:4,paintImageXObjectRepeat:5,paintImageMaskXObject:6};
 const text='Contrato digital com campos e cláusulas. '.repeat(25);
 assert.equal(needsPdfOcr(text,{fnArray:[5],argsArray:[['logo',25,25,new Float32Array([0,0,100,100])]]},codes,480000),false);
 assert.equal(needsPdfOcr(text,{fnArray:[5],argsArray:[['scan',600,800,new Float32Array([0,0])]]},codes,480000),true);
 assert.equal(needsPdfOcr(text,{fnArray:[5],argsArray:[['unknown']]},codes,480000),true);
 assert.equal(needsPdfOcr(text,{fnArray:[3,6],argsArray:[[25,0,0,25,0,0],[]]},codes,480000),false);
 const grouped={...codes,paintImageMaskXObjectRepeat:7,paintImageMaskXObjectGroup:8};
 assert.equal(needsPdfOcr(text,{fnArray:[7],argsArray:[['mask',20,0,0,20,new Float32Array([0,0,20,20])]]},grouped,480000),false);
 assert.equal(needsPdfOcr(text,{fnArray:[8],argsArray:[[[{transform:[20,0,0,20,0,0]}]]]},grouped,480000),false);
 assert.equal(needsPdfOcr(text,{fnArray:[8],argsArray:[[[{transform:[600,0,0,800,0,0]}]]]},grouped,480000),true);
});
