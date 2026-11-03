import {test} from 'node:test';
import assert from 'node:assert/strict';
import {processingSummaryReport} from '../server/processing-summary.js';
import {summaryDocument} from '../src/summary-document.js';
test('documento de resumo destaca chamado e anexo sem expor identificador técnico ou executar HTML',()=>{
 const report=processingSummaryReport('Aguardando análise',[{id:'KD-1',glpi_id:'123',school:'Escola <teste>',type:'Aditivo',status:'Aguardando análise',issues:[{label:'file:12345',source:'Cartão CNPJ.jpeg',message:'Texto <script>alert(1)</script> incompleto',expected:'12.345.678/0001-90'}]}]);
 const html=summaryDocument(report);
 assert.match(html,/<h2>GLPI #123 — Aditivo<\/h2>/);
 assert.match(html,/<strong>Cartão CNPJ.jpeg<\/strong>/);
 assert.ok(!html.includes('file:12345'));
 assert.ok(!html.includes('<script>'));
 assert.ok(html.includes('&lt;script&gt;'));
 assert.match(html,/Referência no GLPI/);
 assert.match(html,/Escola &lt;teste&gt;/);
});
test('resumo de correção separa valor lido e valor solicitado',()=>{
 const report=processingSummaryReport('Aguardando correção',[{id:'KD-2',school:'Escola',type:'Contrato',status:'Aguardando correção',issues:[{label:'Taxa',message:'Divergência',found:'4,50%',expected:'4,58%'}]}]);
 const html=summaryDocument(report);
 assert.match(html,/No documento:<\/strong> 4,50%/);
 assert.match(html,/Como deve ser preenchido:<\/strong> 4,58%/);
});
