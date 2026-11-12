import {test} from 'node:test';
import assert from 'node:assert/strict';
import {conversationEntries,conversationExpectations,requestExpectations,corroboratedDecimalCnpj} from '../server/request-expectations.js';

test('separa taxa geral da taxa da simulação aprovada de antecipação',()=>{
 const title='JURIDICO : SOLICITAÇÃO DE ANTECIPAÇÃO DE RECEBÍVEIS PARA ESCOLAS';
 const content=['*APROVADA - SOLICITAÇÃO DE ADIANTAMENTO DE REPASSE*','*Informações Gerais*','Taxa Kedu: 14,9%','*Motivo da Solicitação:*','Adiantamento de repasse','*Simulação 1x*','Taxa: 4,50%'].map(l=>`<p>${l}</p>`).join('');
 assert.deepEqual(conversationExpectations({title,content}).remuneracao,['4,50%']);
 assert.deepEqual(conversationExpectations({title,content:content.replace('APROVADA','PENDENTE')}).remuneracao,['14,90%','4,50%']);
 assert.deepEqual(conversationExpectations({title,content,followups:[{content:'<p>Taxa: 5,00%</p>'}]}).remuneracao,['4,50%','5,00%']);
});

test('CNPJ decimal só recupera zero inicial com identificador válido e corroborado',()=>{
 const printed='02.188.157/0001-18';
 assert.equal(corroboratedDecimalCnpj('2.188.157.000.118,00',printed),printed);
 for(const reference of ['2188157000118','2.188.157.000.118,01','2.188.157.000.119,00']){
  assert.equal(corroboratedDecimalCnpj(reference,printed),undefined);
 }
 assert.equal(corroboratedDecimalCnpj('2.188.157.000.119,00','02.188.157/0001-19'),undefined);
});

test('normaliza o CNPJ exibido como inteiro decimal no GLPI apenas se os dígitos forem válidos',()=>{
 assert.deepEqual(requestExpectations('<p>CNPJ: 41.301.376.000.113,00</p>').cnpj,['41.301.376/0001-13']);
 for(const value of ['41301376000113,01','41.301.376.000.114,00']){
  assert.deepEqual(requestExpectations(`<p>CNPJ: ${value}</p>`).cnpj,[value]);
 }
});

test('A conversa mantém cada anexo na mensagem de origem e omite notas privadas',()=>{
 const entries=conversationEntries({
  content:'<p>Pedido inicial</p>',
  followups:[{id:'1',content:'<p>Segue o contrato</p>'},{id:'2',content:'Nota interna',private:true}],
  documentLinks:{initial:['10'],'1':['20'],'2':['30']},
  messageAuthors:{'1':'Pessoa solicitante'},
 });
 assert.deepEqual(entries.map(({id,documents,author})=>({id,documents,author})),[
  {id:'initial',documents:['10'],author:undefined},
  {id:'1',documents:['20'],author:'Pessoa solicitante'},
 ]);
});

test('A conversa complementa o formulário e mantém referências conflitantes',()=>{
 const fields=conversationExpectations({
  content:'<p>Banco: Itaú</p>',
  followups:[{content:'<p>Banco: Bradesco</p><p>Agência: 1234</p>'},
   {content:'<p>Conta: 9999</p>',private:true}],
 });
 assert.deepEqual(fields.banco,['Itaú','Bradesco']);
 assert.deepEqual(fields.agencia,['1234']);
 assert.equal(fields.conta,undefined);
});
import {analyzeTicket} from '../server/glpi-analysis.js';
import {installmentTableFields} from '../server/installment-table.js';
import {sameRequestedValue} from '../server/request-expectations.js';
test('equivalência ignora caixa, acentos e separadores bancários, sem corrigir letras ou dígitos',()=>{
 assert.equal(sameRequestedValue('cidade','Itaguaí','ITAGUAI'),true);
 assert.equal(sameRequestedValue('cidade','IITAGUAI','ITAGUAI'),false);
 assert.equal(sameRequestedValue('conta','68146786-2','681467862'),true);
 assert.equal(sameRequestedValue('conta','000123-X','000123x'),true);
 assert.equal(sameRequestedValue('conta','000123-X','123X'),false);
 assert.equal(sameRequestedValue('conta','68146786-2','681467863'),false);
});
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
 assert.deepEqual(installmentTableFields(text,'3'),{remuneracao:['4,50%'],parcelas:['3'],valor:['1507,90'],valorParcela:['574,90']});
 assert.deepEqual(installmentTableFields(text,undefined),{});assert.deepEqual(installmentTableFields(text,'9'),{});
});
test('Filtra CNPJ da própria Kedu quando citado junto ao CNPJ da escola e resolve transição explícita de taxa (de X% para Y%)',()=>{
 const ticketHtml='<p>CNPJ: 11.444.777/0001-61</p><p>Contratada: Kedu Serviços e Soluções Educacionais LTDA - CNPJ: 45.543.580/0001-99</p><p>Solicitamos redução da Taxa Kedu de 14,9% para 12,5%</p>';
 const fields=requestExpectations(ticketHtml);
 assert.deepEqual(fields.cnpj,['11.444.777/0001-61']);
 assert.deepEqual(fields.remuneracao,['12,50%']);
});

