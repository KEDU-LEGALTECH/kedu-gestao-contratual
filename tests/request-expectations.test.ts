import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requestExpectations} from '../server/request-expectations.js';
import {analyzeTicket} from '../server/glpi-analysis.js';
import {installmentTableFields} from '../server/installment-table.js';
const content='<table><tr><td>RAZÃO SOCIAL:</td><td>Escola teste</td></tr><tr><td>CNPJ:</td><td>11444777000161</td></tr><tr><td>MOTIVO DO ADITIVO:</td><td>PARCELAMENTO DE DÉBITOS</td></tr><tr><td>OBSERVAÇÕES OU CONSIDERAÇÕES ADICIONAIS:</td><td>Valor parcelado: R$ 1.507,90<br>Remuneração Kedu: 4,58%<br>QTD parcelas: 3</td></tr></table>';
test('Lê valores explícitos das observações de um formulário GLPI em tabela',()=>{
 const f=requestExpectations(content);assert.deepEqual(f.valor,['1507,90']);assert.deepEqual(f.remuneracao,['4,58%']);assert.deepEqual(f.parcelas,['3']);assert.deepEqual(f.cnpj,['11.444.777/0001-61']);
});
test('Observações em uma única célula também preservam valores separados',()=>{
 const f=requestExpectations(content.replaceAll('<br>','; '));assert.deepEqual(f.valor,['1507,90']);assert.deepEqual(f.remuneracao,['4,58%']);assert.deepEqual(f.parcelas,['3']);
});
test('Parcelamento explícito prevalece sobre título genérico de aditivo e menção à remuneração',()=>{
 const raw:any={externalId:'teste',title:'SOLICITAÇÃO DE ADITIVO DE CONTRATO PARA ESCOLAS',content,documents:[],documentsAvailable:true};
 assert.equal(analyzeTicket(raw,{schools:[],matrices:[]}).suggestion.type,'Parcelamento');
});
test('Tabela de simulação usa apenas a linha solicitada e não confunde taxa do contrato com remuneração do parcelamento',()=>{
 const text='Taxa Kedu 11,3%\nParcelamentos contratados\nRemuneração Meses Principal Carência Valor Parcela\n4,50% 3 R$ 1.507,90 R$72,49 R$574,90\n4,50% 6 R$ 1.507,90 R$72,49 R$306,40';
 assert.deepEqual(installmentTableFields(text,'3'),{remuneracao:['4,50%'],parcelas:['3'],valor:['1507,90']});
 assert.deepEqual(installmentTableFields(text,undefined),{});assert.deepEqual(installmentTableFields(text,'9'),{});
});
