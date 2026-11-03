import {test} from 'node:test';
import assert from 'node:assert/strict';
import {doclingBatchReport} from '../server/docling-batch-report.js';
test('relatório separa ganho de campos, etapas e leituras não aplicadas',()=>{
 const text=doclingBatchReport({at:'2026-11-03T18:00:00Z',examined:10,eligibleDemands:2,eligibleFiles:3,pages:5,uniquePages:4,failedPages:0,before:{stages:{'Aguardando análise':10},fields:{missing:12,matches:3}},after:{stages:{'Aguardando análise':10},fields:{missing:10,matches:5}},changes:[{glpi:'123',field:'cnpj',from:'missing',to:'matches',found:'11.444.777/0001-61'}],applied:[{}],notApplied:[{id:'file',reason:'Confirmação humana'}],skipped:[]});
 assert.match(text,/\| Não localizado \| 12 \| 10 \|/);
 assert.match(text,/\| Aguardando análise \| 10 \| 10 \|/);
 assert.match(text,/GLPI #123/);assert.match(text,/Confirmação humana/);
});
