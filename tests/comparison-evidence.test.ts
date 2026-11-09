import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withDocumentAddress,hasDigitalField,qualifiedNameNeedsReview} from '../server/comparison-evidence.js';
import {sameFieldValue} from '../shared/value-comparison.js';

test('qualificação entre parênteses exige associação de empresa, sem aprovar ou acusar erro pelo nome curto',()=>{
 assert.equal(qualifiedNameNeedsReview('razaoSocial',['ESCOLA TESTE (ASSOCIAÇÃO EDUCADORA)'],['Escola Teste']),true);
 assert.equal(qualifiedNameNeedsReview('razaoSocial',['OUTRA ESCOLA'],['Escola Teste']),false);
 assert.equal(qualifiedNameNeedsReview('razaoSocial',['ESCOLA TESTE'],['Escola Teste']),false);
});
test('marcador NUM não cria divergência de endereço, mas número diferente continua divergente',()=>{
 assert.equal(sameFieldValue('endereco','R SILVER, 314','RUA SILVER NUM 314'),true);
 assert.equal(sameFieldValue('endereco','R SILVER, 315','RUA SILVER NUM 314'),false);
});
test('endereço é composto por rua e número do mesmo anexo, sem escolher alternativas',()=>{
 assert.deepEqual(withDocumentAddress({rua:['R CARAJÁS'],numero:['50']}).endereco,['R CARAJÁS, 50']);
 assert.equal(withDocumentAddress({rua:['Rua A','Rua B'],numero:['50']}).endereco,undefined);
 assert.equal(withDocumentAddress({rua:['Rua A']}).endereco,undefined);
 assert.deepEqual(withDocumentAddress({endereco:['Rua B, 10'],rua:['Rua A'],numero:['50']}).endereco,['Rua B, 10']);
});
test('campo digital preserva certeza individual em PDF parcial sem aprovar OCR ou cálculos',()=>{
 const r={method:'PDF com OCR',incomplete:true,digitalFields:{cnpj:['31.259.972/0001-29'],rua:['R CARAJÁS'],numero:['50']}};
 assert.equal(hasDigitalField(r,'cnpj','31.259.972/0001-29'),true);
 assert.equal(hasDigitalField(r,'endereco','Rua Carajás, 50'),true);
 assert.equal(hasDigitalField(r,'cnpj','11.444.777/0001-61'),false);
 assert.equal(hasDigitalField({...r,method:'OCR de imagem'},'cnpj','31.259.972/0001-29'),false);
 assert.equal(hasDigitalField({...r,formulaCount:1},'cnpj','31.259.972/0001-29'),false);
});

test('nome do cabeçalho NOME (CNPJ) sem forma jurídica não comprova razão social diferente',async()=>{
 const {headerTradeName}=await import('../server/comparison-evidence.js');
 const text='ANEXO l - Demonstrativo de kedu investe e Deduções \nCOLEGIO ERON (61.724.963/0001-22) \nDetalhamento';
 assert.equal(headerTradeName(text,'COLEGIO ERON'),true);
 assert.equal(headerTradeName('ESCOLA ALFA LTDA (61.724.963/0001-22)','ESCOLA ALFA LTDA'),false);
 assert.equal(headerTradeName('Contratante: COLEGIO ERON, CNPJ 61.724.963/0001-22','COLEGIO ERON'),false);
});
test('sigla da escola no resumo de descredenciamento não comprova razão social diferente',async()=>{
 const {headerTradeName}=await import('../server/comparison-evidence.js');
 const text='PLANILHA: Resumo\nRECISÃO\nA PAGAR PELA ESCOLA\n[DADO CALCULADO: conferir na planilha original]\nCEX\n41.301.376/0001-13\nDados gerais';
 assert.equal(headerTradeName(text,'CEX'),true);
 assert.equal(headerTradeName(text.replace('CEX','CENTRO EXEMPLO LTDA'),'CENTRO EXEMPLO LTDA'),false);
});
