import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recoverTextFields} from '../server/text-recovery.js';
import {bankFields} from '../server/bank-reading.js';
test('recupera sede da empresa sem adotar endereço residencial da representante',()=>{
 const text='MONIQUE RAMOS, residente e domiciliada na Avenida Belmonte, nº 233, Ilhéus, Bahia, CEP 45.650-040.\nDA SEDE\nA sociedade mantém sua sede na Avenida Belmonte, nº 161, bairro Conquista, Ilhéus, Bahia, CEP 45.650-040, Brasil.';
 const result=recoverTextFields(text,{});
 assert.ok(result.endereco[0].includes('161'));assert.ok(!result.endereco[0].includes('233'));
 assert.deepEqual(recoverTextFields('Residente na Rua A, 233, Ilhéus, Bahia, CEP 45.650-040.',{}).endereco,undefined);
 assert.deepEqual(recoverTextFields(text,{endereco:['Endereço já conferido']} ).endereco,undefined);
});
test('marca de banco sem espaços só é lida com contexto explícito de extrato e conta',()=>{
 const statement='Extrato de Conta Corrente\nCliente: IZABEL N SILVA - ME\nPeríodo: 01 a 30/06/2026 Agência: 1283-1 Conta:21575-9\nBANCODOBRASIL BANCODOBRASIL';
 assert.deepEqual(bankFields(statement).banco,['Banco do Brasil']);
 assert.equal(bankFields('Empresa sediada no Brasil, Agência: 1283-1 Conta:21575-9').banco,undefined);
 assert.equal(bankFields('Texto menciona BANCODOBRASIL').banco,undefined);
});
test('recupera localização explícita e ignora localidade de nascimento',()=>{
 assert.deepEqual(recoverTextFields('* Localização: Feira Grande - AL',{}).cidade,['Feira Grande']);
 assert.equal(recoverTextFields('Nascida em Feira Grande - AL',{}).cidade,undefined);
});
test('rótulo armazenado como valor não bloqueia recuperação de cidade por contexto',()=>{
 assert.deepEqual(recoverTextFields('* Localização: Feira Grande - AL',{cidade:['MUNICIPIO']}).cidade,['Feira Grande']);
});
