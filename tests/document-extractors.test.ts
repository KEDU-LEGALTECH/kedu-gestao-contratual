import {test} from 'node:test';
import assert from 'node:assert/strict';
import {qualificationFields} from '../server/qualification-reading.js';
import {bankFields} from '../server/bank-reading.js';
import {plausibleFieldValue,ownIdentity} from '../server/field-plausibility.js';
import {sameRequestedValue} from '../server/request-expectations.js';
import {fieldsFromLines} from '../server/processing-extract.js';
import {automaticReadingCheck} from '../server/reading-policy.js';

const contract=`Síntese do contrato
Contratante
COLEGIO SANTA CLARA LTDA, sociedade, inscrita no CNPJ/ME sob o nº 05.756.752/0001-09, com sede na RUA 2 S/N, n° S/N, Bairro:S
DO TURISTA II, na cidade de CALDAS NOVAS, Estado de GOIÁS, CEP: 75696-076, neste ato representado (a) na por seu representante
legal FATIMA MAYUMI MIZUNO AUGUSTO, cujo cpf é 382.166.391-04, neste ato denominado como [Instituição de Ensino].
Contratado
KEDU SERVICOS E SOLUCOES EDUCACIONAIS E FINANCEIRAS LTDA pessoa jurídica de direito privado, inscrita no CNPJ/ME sob o n°
45.543.580/0002-82, com sede na Rua Medianeira, 81 - Aldeota, Fortaleza - CE, 60.140-080 FORTALEZA, CE, neste ato representada
por seu representante legal, neste ato denominado como [kedu].`;

test('qualificação das partes: escola identificada, Kedu ignorada',()=>{
 const fields=qualificationFields(contract,cnpj=>ownIdentity('cnpj',cnpj));
 assert.deepEqual(fields.cnpj,['05.756.752/0001-09']);
 assert.deepEqual(fields.razaoSocial,['COLEGIO SANTA CLARA LTDA']);
 assert.deepEqual(fields.cidade,['CALDAS NOVAS']);
 assert.deepEqual(fields.estado,['GO']);
 assert.deepEqual(fields.cep,['75696-076']);
 assert.deepEqual(fields.representanteNome,['FATIMA MAYUMI MIZUNO AUGUSTO']);
 assert.deepEqual(fields.representanteCpf,['382.166.391-04']);
});

test('qualificação aceita traços de OCR e recusa título do documento como razão social',()=>{
 const fields=qualificationFields(`CONTRATO DE PRESTAÇÃO DE SERVIÇOS, inscrita no CNPJ sob o nº 05.148.852/0001 — 44, com sede na Av. Dom Hélder Câmara, nº 2376, Rio de Janeiro/RJ`);
 assert.deepEqual(fields.cnpj,['05.148.852/0001-44']);
 assert.equal(fields.razaoSocial,undefined);
 assert.deepEqual(fields.numero,['2376']);
 assert.deepEqual(fields.estado,['RJ']);
 // An invalid CNPJ is never an anchor.
 assert.deepEqual(qualificationFields('ESCOLA X LTDA, inscrita no CNPJ sob o nº 05.148.852/0001-45, com sede na Rua A, nº 1'),{});
});

test('bloco bancário no corpo do contrato e declaração de conta',()=>{
 const inline=bankFields('dias. BANCO: SANTANDER \nAGÊNCIA: 1962 \nCONTA: 13000428-4 \nTITULAR DA CONTA: TELMA LUCIA FREITAS LUZ \nCNPJ/CPF: 07438321000111 Ocorrerá em 02 parcelas');
 assert.deepEqual(inline,{banco:['SANTANDER'],agencia:['1962'],conta:['13000428-4'],titularConta:['TELMA LUCIA FREITAS LUZ'],documentoTitular:['07.438.321/0001-11']});
 const statement=bankFields('Informações do titular da conta\nNome Paula da Silva Faria\nCPF 077.812.387-10\nInformações da conta\nBanco 0260 - Nu Pagamentos S.A. - Instituição de Pagamento\nAgência 0001\nConta 953608892-6');
 assert.deepEqual(statement.titularConta,['Paula da Silva Faria']);
 assert.deepEqual(statement.documentoTitular,['077.812.387-10']);
 assert.deepEqual(statement.agencia,['0001']);
 assert.equal(sameRequestedValue('banco',statement.banco[0],'Nubank'),true);
 assert.deepEqual(bankFields('BANCO: (preencher) AGÊNCIA: 1 CONTA: 2').banco,undefined);
});

test('rótulos e valores impossíveis não viram dados do documento',()=>{
 assert.equal(plausibleFieldValue('cnpj','DATA DE ABERTURA'),false);
 assert.equal(plausibleFieldValue('cep','BAIRRO/DISTRITO'),false);
 assert.equal(plausibleFieldValue('remuneracao','Sistema para matricula'),false);
 assert.equal(plausibleFieldValue('cnpj','45.543.580/0001-00'),true);
 assert.equal(ownIdentity('cnpj','45.543.580/0002-82'),true);
 const fields=fieldsFromLines(['NOME EMPRESARIAL','P A L DE LIMA MATIAS','TÍTULO DO ESTABELECIMENTO (NOME DE FANTASIA)','ESCOLA CANTINHO','PORTE','ME']);
 assert.deepEqual(fields.razaoSocial,['P A L DE LIMA MATIAS']);
 assert.ok(!fields.nomeFantasia?.includes('PORTE'));
});

test('razão social: sufixo societário, pontuação e aspas não indicam outra empresa',()=>{
 assert.equal(sameRequestedValue('razaoSocial','SINERGYTECH PARTICIPAÇÕES LTDA.','SINERGYTECH PARTICIPACOES LTDA'),true);
 assert.equal(sameRequestedValue('razaoSocial','CREDENCIAL EVENTOS LTDA - ME','CREDENCIAL EVENTOS LTD'),true);
 assert.equal(sameRequestedValue('razaoSocial','CENTRO EDUCACIONAL "RENASCER"','CENTRO EDUCACIONAL RENASCER'),true);
 for(const key of ['razaoSocial','nomeFantasia','titularConta']){
  for(const name of ['ESCOLA RENASCER LTDA.','ESCOLA, RENASCER LTDA','"ESCOLA RENASCER LTDA','«ESCOLA RENASCER» LTDA','ESCOLA RENASCER LTDA.”'])assert.equal(sameRequestedValue(key,name,'ESCOLA RENASCER LTDA'),true,name);
  assert.equal(sameRequestedValue(key,'ESCOLA D’ÁGUA LTDA','ESCOLA DAGUA LTDA'),true);
  assert.equal(sameRequestedValue(key,'ESCOLA RENASCER 1 LTDA','ESCOLA RENASCER 2 LTDA'),false);
 }
 assert.equal(sameRequestedValue('razaoSocial','CENTRO EDUCACIONAL JOSE DE ALENCAR LTDA','ORGANIZAÇÃO EDUCACIONAL JOSÉ DE ALENCAR LTDA - COLÉGIO J.A. BABY'),false);
 assert.equal(sameRequestedValue('cnpj','07.710.169/0001-84','10.344.629/0001-02'),false);
 assert.equal(sameRequestedValue('razaoSocial','RESTAURANTE SIRIGADO DO PEDRO','SIRIGADO DO PEDRO LTDA'),false);
 assert.equal(sameRequestedValue('agencia','01887','1887'),true);
});

test('CNPJ válido com rótulo, página e valor idêntico ao pedido valida a leitura; valor diferente não',()=>{
 const reading={text:'CNPJ 05.756.752/0001-09',pages:1,method:'OCR de imagem',fields:{cnpj:['05.756.752/0001-09']}};
 assert.equal(automaticReadingCheck(reading,'registration',{cnpj:['05.756.752/0001-09']}),true);
 assert.equal(automaticReadingCheck(reading,'registration',{cnpj:['41.990.137/0001-18']}),false);
 assert.equal(automaticReadingCheck({...reading,fields:{cnpj:['05.756.752/0001-09'],cidade:['CALDAS NOVAS']}},'registration',{cnpj:['05.756.752/0001-09']}),false);
});

test('endereço é comparado por rua e número, não pela frase inteira',()=>{
 assert.equal(sameRequestedValue('endereco','R DOUTOR CELESTINO, 40, CENTRO','R DOUTOR CELESTINO - 40 - ITAGUAI - RJ'),true);
 assert.equal(sameRequestedValue('endereco','Rua Nossa Senhora Do Perpetuo Socorro Nº 108 Bairro: Rio Verde','R NOSSA SENHORA DO PERPETUO SOCORRO'),true);
 assert.equal(sameRequestedValue('endereco','Av. Hermínio de Castro, nº 80','Avenida Herminio de Castro 80'),true);
 assert.equal(sameRequestedValue('endereco','RUA SERTÃO DO INHAMUNS, nº 60','R SERTAO DOS INHAMUNS, 201'),false);
 assert.equal(sameRequestedValue('endereco','Rua A, 10','Rua B, 10'),false);
});

import {notApplicableReason,cessionClauseCheck,reportIdentity} from '../server/comparison-profile.js';
import {attachmentRole} from '../server/reading-policy.js';
test('campo ausente que o tipo de documento não contém não bloqueia; valor lido continua comparado',()=>{
 const template={name:'Contrato REGULAR - Pais X Escolas.docx',text:'CPF: {{cpf_contratante}} CNPJ: {{cnpj_escola}} valor {{valor_parcela}}'};
 assert.match(notApplicableReason('Aditivo','cnpj',[template]),/modelos com marcadores/);
 assert.equal(notApplicableReason('Aditivo','remuneracao',[template]),'');
 assert.match(notApplicableReason('Descredenciamento','endereco',[{name:'r.xlsx',text:'x'}]),/descredenciamento/i);
 assert.equal(notApplicableReason('Descredenciamento','cnpj',[{name:'r.xlsx',text:'x'}]),'');
 assert.equal(notApplicableReason('Contrato de garantia','cnpj',[{name:'c.pdf',text:'contrato'}]),'');
});
test('contrato educacional: cláusula de cessão à Kedu é conferida',()=>{
 const parents='O Contratante pagará a anuidade do aluno. ';
 const ok=cessionClauseCheck('Contrato educacional',[{name:'c.docx',text:parents+'CLÁUSULA 26ª– Fica expressa a anuência do Contratante à cessão pela Escola à Kedu dos créditos resultantes.'}]);
 assert.equal(ok?.status,'matches');
 assert.equal(cessionClauseCheck('Contrato educacional',[{name:'c.docx',text:parents+'Cláusulas sem cessão.'}])?.status,'different');
 assert.equal(cessionClauseCheck('Contrato educacional',[{name:'c.pdf',text:parents+'Cláusulas sem cessão.',method:'PDF com OCR'}])?.status,'missing');
 assert.equal(cessionClauseCheck('Contrato educacional',[{name:'c.docx',text:parents+'Cláusula de Cessão de Recebíveis - a Escola pode ceder os créditos a terceiros.'}])?.status,'review');
 // A Kedu service contract (no tuition/student) is not a parents contract.
 assert.equal(cessionClauseCheck('Contrato educacional',[{name:'c.docx',text:'Contrato Kedu Matrículas entre a Kedu e a escola.'}]),null);
});
test('relatório de descredenciamento identifica a escola pelo nome acima do CNPJ',()=>{
 assert.deepEqual(reportIdentity('DESCREDENCIAMENTO\n[DADO CALCULADO]\nCOLEGIO INVICTOS: JULHO/2026\n49.172.814/0001-00\nData'),{cnpj:'49.172.814/0001-00',razaoSocial:'COLEGIO INVICTOS'});
 // The reference month is never part of the school name, whatever the separator.
 for(const header of ['COLEGIO INVICTOS - QI: MAIO 2025','COLEGIO INVICTOS - QI   JULHO 2025','COLEGIO INVICTOS - QI: Agosto/2025'])
  assert.equal(reportIdentity(`DESCREDENCIAMENTO\n${header}\n49.172.814/0001-00`)?.razaoSocial,'COLEGIO INVICTOS - QI',header);
 assert.equal(reportIdentity('DESCREDENCIAMENTO\nESCOLA MAIO\n49.172.814/0001-00')?.razaoSocial,'ESCOLA MAIO');
});
test('planilha de descredenciamento usa a identidade da escola no resumo',()=>{
 const text='PLANILHA: Resumo\nDescredenciamento\n[DADO CALCULADO]\nColégio Exemplo: Julho\n41.301.376/0001-13\nPLANILHA: Operadora\nKedu\n45.543.580/0001-00';
 assert.equal(attachmentRole('planilha.xlsx',text),'report');
 assert.deepEqual(reportIdentity(text),{cnpj:'41.301.376/0001-13',razaoSocial:'Colégio Exemplo'});
 assert.equal(reportIdentity(text.replace('41.301.376/0001-13','')),null);
});
test('resumo de descredenciamento com o motivo da saída também identifica a escola',()=>{
 const text='PLANILHA: Resumo\nRECISÃO\nA PAGAR PELA ESCOLA\n[DADO CALCULADO: conferir na planilha original]\nCOLEGIO EXEMPLO\n41.301.376/0001-13\nDados gerais';
 assert.equal(attachmentRole('DESCREDENCIAMENTO - COLEGIO EXEMPLO.xlsx',text),'report');
 assert.deepEqual(reportIdentity(text),{cnpj:'41.301.376/0001-13',razaoSocial:'COLEGIO EXEMPLO'});
 // The same words in a contract or a PDF do not turn it into a settlement report.
 assert.notEqual(attachmentRole('contrato.pdf',text),'report');
 assert.notEqual(attachmentRole('planilha.xlsx','PLANILHA: Dados\nValores\nTotal geral'),'report');
});
