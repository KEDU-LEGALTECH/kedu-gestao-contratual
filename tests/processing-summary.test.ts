import {test} from 'node:test';
import assert from 'node:assert/strict';
import {processingSummaryReport} from '../server/processing-summary.js';
const demand={id:'KD-1',glpi_id:'123',school:'Escola teste',type:'Aditivo',status:'Aguardando correção',issues:[{label:'Taxa',message:'Divergência com o pedido',found:'4,50%',expected:'4,58%'}]};
test('resumo de correções contém origem, diferença e apenas a etapa selecionada',()=>{
 const report=processingSummaryReport('Aguardando correção',[demand,{...demand,id:'outro',status:'Aguardando análise'}]);
 assert.equal(report.count,1);assert.equal(report.filename,'Pendencias_de_correcao.md');
 for(const term of ['GLPI #123','Escola teste','4,50%','4,58%'])assert.ok(report.markdown.includes(term));
 assert.ok(!report.markdown.includes('outro'));
});
test('análise possui resumo próprio e recorte vazio fica explícito',()=>{
 const report=processingSummaryReport('Aguardando análise',[]);assert.equal(report.count,0);
 assert.equal(report.filename,'Pendencias_de_analise.md');assert.match(report.markdown,/Nenhuma demanda/);
});
