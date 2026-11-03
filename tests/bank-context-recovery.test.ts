import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bankFields} from '../server/bank-reading.js';

test('Caixa usa conta explicitamente rotulada, preservando zeros e sem adotar operação Pix',()=>{
 const text='Dados do Recebedor\nNome\nEMPRESA EXEMPLO LTDA\nConta\n1887 1292 000565202357-\n7\nBem-vindo(a), FELIPE\nAgência: 01887\nConta: 000565202357-7 \nhttps://gerenciador.caixa.gov.br/empresa/dashboard/pix/recebimento';
 const fields=bankFields(text);
 assert.deepEqual(fields.conta,['000565202357-7']);assert.deepEqual(fields.agencia,['01887']);assert.deepEqual(fields.banco,['Caixa Econômica Federal']);
 assert.ok(!fields.titularConta?.includes('FELIPE'));
 assert.equal(bankFields(text.replace('Conta: 000565202357-7','Conta 000565202357-7')).conta,undefined);
 assert.equal(bankFields(text+'\nConta: 999999-1').conta,undefined);
 assert.equal(bankFields(text.replace('gerenciador.caixa.gov.br','example.com')).banco,undefined);
});

test('Cora SCFI com Ag/c/c recupera banco e não infere titular pelo nome exibido',()=>{
 const text='NOME DA EMPRESA\nCora SCFI - 403\nAg 0001 - c/c 5540818-5\nCNPJ 58.902.291/0001-93';
 const fields=bankFields(text);assert.deepEqual(fields.banco,['Cora']);assert.deepEqual(fields.conta,['5540818-5']);assert.equal(fields.titularConta,undefined);
 assert.equal(bankFields(text+'\nPagador').banco,undefined);
 assert.equal(bankFields(text+'\nAg 0002 - c/c 111111-1').banco,undefined);
 assert.equal(bankFields('Cora SCFI - 403\nTexto sem dados bancários').banco,undefined);
});
