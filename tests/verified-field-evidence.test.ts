import {test} from 'node:test';
import assert from 'node:assert/strict';
import {automaticReadingCheck} from '../server/reading-policy.js';
import {recoverTextFields} from '../server/text-recovery.js';
import {normalizeValue} from '../server/processing-extract.js';
import {requestExpectations} from '../server/request-expectations.js';
import {extractContractParties} from '../server/contract-parties.js';
import {plausibleFieldValue} from '../server/field-plausibility.js';
test('descrição do serviço não vira nome de empresa por causa de CNPJ na seção bancária seguinte',()=>{
 assert.deepEqual(extractContractParties('Contratado: 2 tipos de bolos, mini salada de frutas\nDados de Pagamento: Pix\nCafé mais Chef CNPJ: 40.139.291/0001-18'),[]);
 assert.equal(plausibleFieldValue('razaoSocial','LTDA - PB'),false);
 assert.equal(plausibleFieldValue('razaoSocial','P. O. PLACIDO ESCOLA TRAVESSIA LTDA'),true);
});
test('rótulo Contratante antes do nome não identifica outra empresa',()=>{
 assert.deepEqual(requestExpectations('<p>RAZÃO SOCIAL: Contratante COLEGIO LUAN KENNEDY LTDA</p>').razaoSocial,['COLEGIO LUAN KENNEDY LTDA']);
});
test('CEPs conflitantes no endereço e no campo CEP do GLPI tornam a referência ambígua',()=>{
 const p=requestExpectations('<p>ENDEREÇO: AV ITALIA, 16, CEP 78.040-240</p><p>CEP: 78065158</p>');
 assert.deepEqual(new Set(p.cep),new Set(['78040-240','78065-158']));
});
test('cidade não incorpora os rótulos da UF ou inscrição municipal',()=>{
 assert.equal(normalizeValue('cidade','PARAUAPEBAS UF: PA Inscrição Municipal: 20177'),'PARAUAPEBAS');
 assert.equal(normalizeValue('cidade','São João del-Rei'),'São João del-Rei');
});
test('agência e conta verificadas por OCR com rótulo explícito não dependem de coincidir com GLPI',()=>{
 const r={text:'Dados bancários\nAgência\n0001\nConta\n68146786-2\nBanco\n0260',method:'OCR de imagem',pages:1,confidence:86,verifiedFields:['agencia','conta','banco'],fields:{agencia:['0001'],conta:['68146786-2'],banco:['0260']}};
 assert.equal(automaticReadingCheck(r,'bank',{agencia:['0001'],conta:['681467862'],banco:['Nubank']}),true);
 assert.equal(automaticReadingCheck(r,'bank',{banco:['Itaú']}),true,'transcrição confiável pode revelar divergência real');
 assert.equal(automaticReadingCheck({...r,verifiedFields:[]},'bank',{}),false);
 assert.equal(automaticReadingCheck({...r,confidence:60},'bank',{}),false);
 assert.equal(automaticReadingCheck({...r,incomplete:true},'bank',{}),false);
 assert.equal(automaticReadingCheck({...r,text:'0001 68146786-2 0260'},'bank',{}),false);
 assert.equal(automaticReadingCheck({...r,pages:3},'bank',{}),false);
 assert.equal(automaticReadingCheck({...r,confidence:20,fieldConfidence:{agencia:92,conta:93,banco:94}},'bank',{}),true,'confiança por campo evita usar a média da página inteira');
 assert.equal(automaticReadingCheck({...r,confidence:20,fieldConfidence:{agencia:92}},'bank',{}),false,'campos sem evidência suficiente não são liberados junto');
});
test('nome explícito de Junta Comercial é recuperado sem consultar GLPI ou escolher entre empresas',()=>{
 const t='Junta Comercial do Estado\nEmpresa: P. O. PLACIDO ESCOLA TRAVESSIA LTDA\nCNPJ 47.709.796/0001-10';
 assert.deepEqual(recoverTextFields(t,{}).razaoSocial,['P. O. PLACIDO ESCOLA TRAVESSIA LTDA']);
 assert.equal(recoverTextFields(t+'\nEmpresa: OUTRA EMPRESA LTDA',{}).razaoSocial,undefined);
 assert.equal(recoverTextFields('Empresa: OUTRA EMPRESA LTDA',{}).razaoSocial,undefined);
});
test('cláusula explícita fornece nome empresarial e sede sem misturar endereço pessoal',()=>{
 const text='Sócia residente na Rua Pessoal, 1.\nA sociedade girará sob o nome empresarial “Instituto Miró de Ensino Ltda”.\nA sociedade terá sua sede na Rua Marcos Barbosa, nº 291, Bairro Centro,\nMamanguape, PB, CEP 58.280-000.';
 const fields=recoverTextFields(text,{});
 assert.deepEqual(fields.razaoSocial,['Instituto Miró de Ensino Ltda']);
 assert.match(fields.endereco[0],/^Rua Marcos Barbosa/);
 assert.doesNotMatch(fields.endereco[0],/Pessoal/);
});
import {verifiedFieldEvidence} from '../server/verified-field-evidence.js';
import {notApplicableReason} from '../server/comparison-profile.js';
test('consenso entre Tesseract e PaddleOCR funciona em documento multipágina quando a página de origem do campo está registrada',()=>{
 const multiPageReading={
  text:'--- PÁGINA 1 ---\nCláusula 1\n--- PÁGINA 2 ---\nDados Bancários\nAgência: 0001\nConta: 68146786-2\n\nLEITURA ADICIONAL — PADDLEOCR / OPENCV\nDados Bancários\nAgência: 0001\nConta: 68146786-2',
  method:'OCR de imagem + PaddleOCR',
  pages:2,
  confidence:72,
  verifiedFields:[],
  fieldOrigins:{
   agencia:[{value:'0001',page:2,excerpt:'Dados Bancários\nAgência: 0001\nConta: 68146786-2'}],
   conta:[{value:'68146786-2',page:2,excerpt:'Dados Bancários\nAgência: 0001\nConta: 68146786-2'}],
  },
  fields:{agencia:['0001'],conta:['68146786-2']},
 };
 assert.equal(verifiedFieldEvidence(multiPageReading as any,'agencia','0001','contract'),true);
 assert.equal(verifiedFieldEvidence({...multiPageReading,fieldOrigins:{}} as any,'agencia','0001','contract'),false,'sem página de origem em documento multipágina não deve aprovar');
});
test('notApplicableReason marca nomeFantasia ausente em contrato sem cláusula de fantasia e dados bancários ausentes em aditivo não bancário',()=>{
 const contractFile={category:'contract',text:'INSTRUMENTO PARTICULAR DE PRESTAÇÃO DE SERVIÇOS\nCONTRATANTE: ESCOLA EXEMPLO LTDA, CNPJ 11.444.777/0001-61, com sede na Rua A, 10.',fields:{razaoSocial:['ESCOLA EXEMPLO LTDA'],cnpj:['11.444.777/0001-61']},incomplete:false};
 assert.match(notApplicableReason('Novo contrato','nomeFantasia',[contractFile as any]),/nome fantasia/i);
 const contractWithTradeName={...contractFile,text:contractFile.text+'\nNome Fantasia: Colégio Exemplo'};
 assert.equal(notApplicableReason('Novo contrato','nomeFantasia',[contractWithTradeName as any]),'');
 const nonBankAddendum={category:'contract',text:'TERMO ADITIVO AO CONTRATO\nCláusula 1 - A taxa passa a ser de 12,50%.',fields:{remuneracao:['12,50%']},incomplete:false};
 assert.match(notApplicableReason('Aditivo','agencia',[nonBankAddendum as any]),/instrumento contratual/i);
 assert.equal(notApplicableReason('Alteração de dados bancários','agencia',[nonBankAddendum as any]),'');
});

