import {test} from "node:test";
import assert from "node:assert/strict";
import {fieldsFromLines} from "../server/processing-extract.js";

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
