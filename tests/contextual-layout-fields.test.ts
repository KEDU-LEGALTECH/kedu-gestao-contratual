import {test} from 'node:test';import assert from 'node:assert/strict';
import {contextualLayoutFields} from '../server/contextual-layout-fields.js';
import {bankFields,receiverBankFields} from '../server/bank-reading.js';
import {scopePartyReading} from '../server/contract-parties.js';
import {documentSourceKind} from '../server/document-evidence.js';
import {unusedPersonalId} from '../server/reading-policy.js';
import {sameFieldValue} from '../shared/value-comparison.js';
import {headerTradeName} from '../server/comparison-evidence.js';
test('número de conta explícito na seção bancária preserva agência e dígito',()=>{
 const text='Dados bancários\nConta Brasileira\nNúmero de conta 26043482-5\nAgência 0001\nBanco 077 - Inter';
 assert.deepEqual(bankFields(text),{conta:['26043482-5'],agencia:['0001']});
 assert.deepEqual(bankFields(text.replace('Conta Brasileira','Pagador')),{});
});
test('cabeçalho de repreço separa o nome da escola da coluna Tempo Operado',()=>{
 const text='Análise de Repreço/Renovação\nEscola Escola Teste Ltda   Tempo Operado   15 meses\nCNPJ   11444777000161   Alunado   95';
 assert.deepEqual(contextualLayoutFields(text).razaoSocial,['Escola Teste Ltda']);
 assert.equal(headerTradeName(text,'Escola Teste Ltda'),true);
 assert.equal(contextualLayoutFields(text.replace('11444777000161','11444777000162')).razaoSocial,undefined);
});
test('alvará não troca razão social pelo nome fantasia',()=>{
 const text='ALVARÁ\nNOME OU RAZÃO SOCIAL\nT C DE SANTANA SANTOS\nNOME FANTASIA\nCENTRO EDUCACIONAL FENIX\nCOMPLEMENTO: CIDADE ESTADO\nCandeias BA';
 const f=contextualLayoutFields(text);assert.deepEqual(f.razaoSocial,['T C DE SANTANA SANTOS']);assert.deepEqual(f.cidade,['Candeias']);assert.deepEqual(f.estado,['BA']);
});
test('alvarás conflitantes não permitem selecionar um nome por conveniência',()=>{
 assert.equal(contextualLayoutFields('NOME OU RAZÃO SOCIAL\nEMPRESA A LTDA\nNOME OU RAZÃO SOCIAL\nEMPRESA B LTDA').razaoSocial,undefined);
});
const receipt='Pix Agendado\nRecebedor\nP A L DE LIMA MATIAS\nCNPJ\n42.616.459/0001-64\nAgência\n3436\nConta\n130073219\nInstituição\n033 BCO SANTANDER (BRASIL) S.A.\nPagador\nPessoa Pagadora\nCPF\n***.922.402-**\nAgência\n2946-7\nConta\n27685-5\nInstituição\n00000000 BCO DO BRASIL S.A.';
test('transferência conserva somente os dados bancários explicitamente do recebedor',()=>{
 const f=receiverBankFields(receipt)!;assert.deepEqual(f.agencia,['3436']);assert.deepEqual(f.conta,['130073219']);assert.deepEqual(f.banco,['033 BCO SANTANDER (BRASIL) S.A.']);assert.deepEqual(f.titularConta,['P A L DE LIMA MATIAS']);
 assert.equal(documentSourceKind({name:'foto.jpeg',text:receipt}),'bank');
 const scoped=scopePartyReading({text:receipt,fields:{agencia:['3436','2946-7'],conta:['130073219','27685-5']}}).reading;
 assert.deepEqual(scoped.fields.agencia,['3436']);assert.deepEqual(scoped.fields.conta,['130073219']);
 assert.equal(receiverBankFields(receipt.replace('42.616.459/0001-64','00.000.000/0000-00')),null);
});
test('cabeçalho identifica CNPJ do fornecedor sem inventar sua razão social pelo logotipo',()=>{
 const f=contextualLayoutFields('MARCA DE TESTE\nCNPJ: 40.139.291/0001-18\nContrato\nEmpresa: KEDU\nCNPJ: 45.543.580/0001-00');
 assert.deepEqual(f.cnpj,['40.139.291/0001-18']);assert.equal(f.razaoSocial,undefined);
});
test('CNH lida sem campos solicitados não bloqueia comparações já conferidas',()=>{
 const r={text:'CARTEIRA NACIONAL DE HABILITAÇÃO',fields:{},pages:1};
 assert.equal(unusedPersonalId(r,'CNH.pdf',{},[{status:'matches'}]),true);
 assert.equal(unusedPersonalId({...r,incomplete:true},'CNH.pdf',{},[{status:'matches'}]),false);
 assert.equal(unusedPersonalId(r,'CNH.pdf',{representanteCpf:['123']},[{status:'matches'}]),false);
 assert.equal(unusedPersonalId(r,'CNH.pdf',{},[{status:'missing'}]),false);
 assert.equal(unusedPersonalId(r,'documento.pdf',{},[{status:'matches'}]),false);
});
test('zeros à esquerda no número predial não criam divergência de endereço',()=>{
 assert.equal(sameFieldValue('endereco','R GENERAL MIGUEL FERREIRA, 00046','Rua General Miguel Ferreira, 46'),true);
 assert.equal(sameFieldValue('endereco','R GENERAL MIGUEL FERREIRA, 00046','Rua General Miguel Ferreira, 47'),false);
});
