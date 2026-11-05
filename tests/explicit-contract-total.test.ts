import {test} from 'node:test';
import assert from 'node:assert/strict';
import {explicitContractTotals} from '../server/explicit-contract-total.js';
import {recoverTextFields} from '../server/text-recovery.js';
import {sameFieldValue} from '../shared/value-comparison.js';
test('recovers an explicit contracted total without confusing fees or line items',()=>{
 const text='Cláusula 9ª. O valor total dos serviços contratados é R$1.195 que devem ser pagos. Taxa de alteração R$ 150,00. Multa R$ 300,00.';
 assert.deepEqual(explicitContractTotals(text),['1195,00']);
 assert.deepEqual(recoverTextFields(text,{}).valorTotal,['1195,00']);
 assert.equal(recoverTextFields(text,{valorTotal:['2.000,00']}).valorTotal,undefined);
 assert.deepEqual(explicitContractTotals('2.2. O valor total da contratação é de R$1.100,00 (mil e cem reais).'),['1100,00']);
});
test('whole reais with an explicit currency/monetary field compare without changing amounts',()=>{
 assert.equal(sameFieldValue('valorTotal','R$1.195','1195,00'),true);
 assert.equal(sameFieldValue('valorTotal','R$1100','1100,00'),true);
 assert.equal(sameFieldValue('valorTotal','R$1.195','119,50'),false);
 assert.equal(sameFieldValue('valorTotal','R$1.19','119,00'),false);
});
test('preserves conflicting explicit totals and does not infer totals from prices',()=>{
 assert.deepEqual(explicitContractTotals('Valor total do contrato é R$ 900,00. Valor total do contrato é R$ 950,00.'),['900,00','950,00']);
 assert.deepEqual(explicitContractTotals('Valor mensal R$ 300,00. Multa R$ 1.195. Total esperado no GLPI: R$ 1.195.'),[]);
 assert.deepEqual(explicitContractTotals('O valor total do contrato é R$ 1.195,9.'),[]);
});

