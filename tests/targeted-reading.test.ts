import {test} from 'node:test';
import assert from 'node:assert/strict';
import {targetedReadingTargets,mergeTargetedReading} from '../server/targeted-reading.js';
const reading={version:4,text:'NOME EMPRESARIAL: ESCOLA EXEMPLO LTDA',fields:{razaoSocial:['ESCOLA EXEMPLO LTDA']},problem:'',method:'OCR',needsReview:true,pages:1};
const pending=[{field:'cnpj',status:'missing',sourceDocuments:['Cartão CNPJ.png']},{field:'razaoSocial',status:'matches'}];
test('seleciona somente pendências e páginas conhecidas, sem valores do GLPI no alvo',()=>{
 const targets=targetedReadingTargets('Cartão CNPJ.png',reading,pending);
 assert.equal(targets.length,1);assert.deepEqual(targets[0].fields,['cnpj']);assert.equal(targets[0].page,1);
 assert.deepEqual(targetedReadingTargets('Cartão CNPJ.pdf',{...reading,pages:12},pending),[],'não adivinha página em PDF longo');
 assert.deepEqual(targetedReadingTargets('Cartão CNPJ.png',reading,pending,['cnpj']),[],'protege campos confirmados');
 assert.deepEqual(targetedReadingTargets('Cartão CNPJ.png',reading,[{field:'cnpj',status:'different'}]),[]);
 assert.deepEqual(targetedReadingTargets('Cartão CNPJ.png',reading,[{field:'cnpj',status:'review',partlyMatches:true}]),[]);
});
test('releitura preserva texto e campos bons e só acrescenta o campo pendente com trecho de origem',()=>{
 const target=targetedReadingTargets('Cartão CNPJ.png',reading,pending)[0];
 const next={text:'CNPJ: 11.444.777/0001-61',fields:{cnpj:['11.444.777/0001-61'],razaoSocial:['OUTRA ESCOLA LTDA']},method:'OCR da região',confidence:90};
 const merged=mergeTargetedReading(reading,next,target);
 assert.equal(merged.text,reading.text);assert.deepEqual(merged.fields.razaoSocial,reading.fields.razaoSocial);
 assert.deepEqual(merged.fields.cnpj,['11.444.777/0001-61']);assert.equal(merged.fieldOrigins.cnpj[0].page,1);
 assert.equal(merged.needsReview,true);assert.equal(merged.method,'OCR');
 assert.deepEqual(targetedReadingTargets('Cartão CNPJ.png',merged,pending),[],'não repete a mesma tentativa');
});
test('falha ou conflito não substitui resultados anteriores nem aprova campos',()=>{
 const r={...reading,fields:{...reading.fields,cnpj:['11.444.777/0001-61']}};
 const target=targetedReadingTargets('Cartão CNPJ.png',r,[{field:'cnpj',status:'review'}])[0];
 const failed=mergeTargetedReading(r,{problem:'Sem memória'},target);
 assert.deepEqual(failed.fields,r.fields);assert.equal(failed.targetedAttempts[0].outcome,'failed');
 assert.deepEqual(targetedReadingTargets('Cartão CNPJ.png',failed,[{field:'cnpj',status:'review'}]),[]);
 const conflict=mergeTargetedReading(r,{text:'CNPJ: 00.817.900/0001-26',fields:{cnpj:['00.817.900/0001-26']}},target);
 assert.deepEqual(conflict.fields.cnpj,r.fields.cnpj);
});
test('origem por página permite retentar apenas a página do campo em PDF longo',()=>{
 const r={...reading,pages:20,fieldOrigins:{cnpj:[{page:7,value:'11.444.777/0001-61',excerpt:'CNPJ'}]}};
 const target=targetedReadingTargets('Contrato.pdf',r,[{field:'cnpj',status:'review',source:'Contrato.pdf'}]);
 assert.equal(target[0].page,7);
});
