import {test} from 'node:test';import assert from 'node:assert/strict';
import {assistedVisualField,assistedVisualAbsence,visualTextHash} from '../server/assisted-visual-evidence.js';
import {automaticReadingCheck} from '../server/reading-policy.js';
const text='Recebedor\nEmpresa Exemplo\nAgência\n0001';
function reading(){const originalHash='a'.repeat(64);return {text,pages:1,needsReview:true,method:'OCR de imagem',fields:{agencia:['0001']},originalHash,sourceFileId:'file1',assistedVisualEvidence:[{source:'original-visual-inspection',reviewer:'assistant-local-pilot',field:'agencia',value:'0001',page:1,excerpt:'Agência 0001',entity:'Empresa Exemplo',reviewedAt:'2026-10-29',sourceFileId:'file1',originalHash,textHash:visualTextHash(text)}]};}
test('conferência visual assistida é separada de simples coincidência com GLPI',()=>{
 const r=reading();assert.ok(assistedVisualField(r,'agencia','0001','bank'));
 assert.equal(automaticReadingCheck(r,'bank',{}),true);
 assert.equal(automaticReadingCheck({...r,assistedVisualEvidence:[]},'bank',{agencia:['0001']}),false);
});
test('evidência não sobrevive a mudança de texto, arquivo, valor ou página',()=>{
 for(const change of [{text:'other'},{sourceFileId:'file2'},{originalHash:'b'.repeat(64)},{incomplete:true}])assert.equal(assistedVisualField({...reading(),...change},'agencia','0001','bank'),null);
 const r=reading();r.assistedVisualEvidence[0].page=2;assert.equal(assistedVisualField(r,'agencia','0001','bank'),null);
 assert.equal(assistedVisualField(reading(),'agencia','0002','bank'),null);
});
test('sugestão do modelo ou rótulo sem valor não constitui conferência independente',()=>{
 const r=reading();r.assistedVisualEvidence[0].source='model-confidence';assert.equal(assistedVisualField(r,'agencia','0001','bank'),null);
 r.assistedVisualEvidence[0].source='original-visual-inspection';r.assistedVisualEvidence[0].excerpt='Agência não lida';assert.equal(assistedVisualField(r,'agencia','0001','bank'),null);
});
test('ausência exige todas as páginas conferidas e perde validade quando o texto muda',()=>{
 const r:any=reading();r.assistedVisualAbsences=[{...r.assistedVisualEvidence[0],field:'valorTotal',pages:[1]}];
 assert.equal(assistedVisualAbsence(r,'valorTotal'),true);
 assert.equal(assistedVisualAbsence({...r,pages:2},'valorTotal'),false);
 assert.equal(assistedVisualAbsence({...r,text:'new text'},'valorTotal'),false);
 assert.equal(assistedVisualAbsence({...r,incomplete:true},'valorTotal'),false);
 assert.equal(assistedVisualAbsence({...r,fields:{valorTotal:['700,00']}},'valorTotal'),false);
});
