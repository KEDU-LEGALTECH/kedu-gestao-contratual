import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assistedVisualField,visualTextHash} from '../server/assisted-visual-evidence.js';
import {automaticReadingCheck} from '../server/reading-policy.js';
function fixture():any{
 const text='Cláusula 2.2. O valor total da contratação é de R$1.100,00.';
 const binding={source:'original-visual-inspection',reviewer:'assistant-local-pilot',originalHash:'a'.repeat(64),sourceFileId:'file',textHash:visualTextHash(text),reviewedAt:'2026-11-04T20:00:00Z'};
 return {text,method:'PDF com OCR',pages:3,pendingPages:[],fields:{valorTotal:['1100,00']},originalHash:binding.originalHash,sourceFileId:'file',assistedVisualCoverage:{...binding,pages:[1,2,3]},assistedVisualEvidence:[{...binding,field:'valorTotal',value:'1100,00',page:2,entity:'Contratada Exemplo',excerpt:text,corroboration:{page:1,excerpt:'TOTAL R$ 1.100,00'}}]};
}
test('contract total requires an explicit clause, a second page and complete bound coverage',()=>{
 const r=fixture();assert.ok(assistedVisualField(r,'valorTotal','1100,00','document'));
 assert.equal(automaticReadingCheck(r,'document',{}),true);
 assert.equal(assistedVisualField(r,'valorTotal','1100,00','bank'),null);
 for(const change of [{pendingPages:[1]},{incomplete:true},{text:'changed'},{assistedVisualCoverage:{...r.assistedVisualCoverage,pages:[2,3]}}])assert.equal(assistedVisualField({...r,...change},'valorTotal','1100,00','document'),null);
});
test('agreement with GLPI or an uncorroborated price never confirms a financial field',()=>{
 for(const mutate of [(r:any)=>delete r.assistedVisualCoverage,(r:any)=>delete r.assistedVisualEvidence[0].corroboration,(r:any)=>r.assistedVisualEvidence[0].corroboration.page=2,(r:any)=>r.assistedVisualEvidence[0].corroboration.excerpt='TOTAL R$ 1.200,00',(r:any)=>r.assistedVisualEvidence[0].excerpt='Multa R$1.100,00']){
  const r=fixture();mutate(r);assert.equal(automaticReadingCheck(r,'document',{valorTotal:['1100,00']}),false);
 }
});
