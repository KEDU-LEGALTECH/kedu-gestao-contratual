import {test} from "node:test";
import assert from "node:assert/strict";
import {fieldsFromLines} from "../server/processing-extract.js";
import {sameRequestedValue} from '../server/request-expectations.js';
import {validateData} from '../shared/data-validation.js';
test('datas lado a lado e pontuação final de dados bancários não geram valores duplicados',()=>{
 const f=fieldsFromLines(['Início: 01/09/2026 | Término: 31/07/2027','Conta corrente: 12345-6.','Conta corrente: 12345-6','Agência: 0001 :','NÚMERO DE INSCRIÇÃO','11.444.777/0001-61','NOME EMPRESARIAL','ESCOLA TESTE']);
 assert.deepEqual(f.inicio,['2026-09-01']);assert.deepEqual(f.fim,['2027-07-31']);assert.deepEqual(f.conta,['12345-6']);assert.deepEqual(f.agencia,['0001']);assert.deepEqual(f.cnpj,['11.444.777/0001-61']);assert.deepEqual(f.razaoSocial,['ESCOLA TESTE']);
});
test('extratos com agência e conta por extenso e marcadores de captura são reconhecidos',()=>{
 const f=fieldsFromLines(['Aplicativo: Agência: 4538 Conta: 130090993','Período: 01 a 30/06/2026 Agência: 1283-1/ Conta: 21575-9','é TITULARIDADE: ESCOLA TESTE','e CNPJ/CPF: 11.444.777/0001-61']);
 assert.deepEqual(f.agencia,['4538','1283-1']);assert.deepEqual(f.conta,['130090993','21575-9']);assert.deepEqual(f.titularConta,['ESCOLA TESTE']);assert.deepEqual(f.documentoTitular,['11.444.777/0001-61']);
});

test('pontuação de frase depois do CNPJ não provoca ausência ou divergência',()=>{
 const cnpj='00.817.900/0001-26';
 assert.deepEqual(fieldsFromLines([`CNPJ ${cnpj}.`]).cnpj,[cnpj]);
 assert.deepEqual(fieldsFromLines([`CNPJ: ${cnpj}.`]).cnpj,[cnpj]);
 assert.ok(sameRequestedValue('cnpj',cnpj,cnpj+'.'));
 assert.equal(validateData({cnpj:cnpj+'.'}).cnpj,undefined);
 assert.ok(validateData({cnpj:cnpj+'1.'}).cnpj);
 assert.equal(sameRequestedValue('cnpj',cnpj,'00.817.900/0001-27.'),false);
});

test('Identidade no cabeçalho nome (CNPJ) e dados de termo financeiro são reconhecidos sem rótulos',()=>{
 const f=fieldsFromLines(['ANEXO I - Demonstrativo','ESCOLA TESTE (11.444.777/0001-61)','Valor (R$) R$ 30.000,00','Nº. de parcelas 24','Remuneração kedu (%) 4,37%']);
 assert.deepEqual(f,{razaoSocial:['ESCOLA TESTE'],cnpj:['11.444.777/0001-61'],valor:['30000,00'],parcelas:['24'],remuneracao:['4,37%']});
});
test('Identidades de partes diferentes não são unificadas nem copiadas de menções no corpo',()=>{
 const f=fieldsFromLines(['EMPRESA A (11.444.777/0001-61)','EMPRESA B (22.222.222/0001-22)']);assert.equal(f.cnpj.length,2);assert.equal(f.razaoSocial.length,2);
 assert.deepEqual(fieldsFromLines([...Array(21).fill('Texto do corpo'),'ESCOLA TESTE (11.444.777/0001-61)']),{});
});

test("identifica banco com agência e conta na mesma linha sem misturar dígitos",()=>{
 assert.deepEqual(fieldsFromLines(["Ag. 3175-5 -« Cc. 25427-4"]),{agencia:["3175-5"],conta:["25427-4"]});
});
test("identifica campos numéricos explícitos em tabelas PDF sem dois-pontos",()=>{
 assert.deepEqual(fieldsFromLines(["CNPJ nº 11.444.777/0001-61","Alunado 95 Ticket Médio R$ 600,00","CEP 43.815-360","Remuneração kedu (%) 3,61%"]),{cnpj:["11.444.777/0001-61"],alunos:["95"],cep:["43815-360"],remuneracao:["3,61%"]});
});
test("campos em branco e títulos seguintes não se tornam valores",()=>{
 const f=fieldsFromLines(["REPRESENTANTE LEGAL: ____________________","CEP:","DATA DE NASCIMENTO:","01/01/2000"]);
 assert.equal(f.representanteNome,undefined);assert.equal(f.cep,undefined);
});
test("não escolhe taxa histórica, capital social, prazo operado ou alternativa de proposta",()=>{
 const f=fieldsFromLines(["Taxa atual 9,00%","Tempo Operado 15 meses","Capital social R$ 50.000,00","Garantia Completa","16% 17% 18%","Juros boleto 4,5% (Atual) 5,5% (Novo)"]);
 assert.deepEqual(f,{});
});
test("valores repetidos são deduplicados e divergências continuam visíveis",()=>{
 assert.deepEqual(fieldsFromLines(["Taxa Kedu: 9%","Taxa Kedu: 9,00%","Taxa Kedu: 11%"]),{remuneracao:["9,00%","11,00%"]});
});
