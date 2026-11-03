import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recoverTextFields} from '../server/text-recovery.js';
import {bankFields,sicoobChequeFields} from '../server/bank-reading.js';
import {verifiedFieldEvidence} from '../server/verified-field-evidence.js';
import {documentSourceKind} from '../server/document-evidence.js';
import {fieldsFromLines} from '../server/processing-extract.js';

test('company seat supplies city/state without using representative residence or court',()=>{
 const text='MARIA, residente na Rua Outra, 9, Salvador, Bahia, CEP 40000-000. A sociedade tem sede na Avenida Belmonte, 161, bairro Conquista, Ilhéus, Bahia, CEP 45.650-040. Foro da comarca de Salvador.';
 const result=recoverTextFields(text,{});
 assert.deepEqual(result.cidade,['Ilhéus']);assert.deepEqual(result.estado,['Estado da Bahia']);
 assert.equal(recoverTextFields('Residente na Rua Outra, 9, Salvador, Bahia, CEP 40000-000. Foro de Salvador.',{}).cidade,undefined);
 assert.equal(recoverTextFields(text,{cidade:['Outra cidade']}).cidade,undefined);
 assert.equal(recoverTextFields('Empresa com sede na Rua Furnas, 66, Jose e Maria Petrolina, PE, CEP 56320550',{}).cidade,undefined);
});

test('mobile bank account recovers bank and labelled agency/account without guessing holder',()=>{
 const text='Santander Empresas\nWilliam\nAg 3455 Cc 130083488\nSair do app';
 assert.deepEqual(bankFields(text),{agencia:['3455'],conta:['130083488'],banco:['Santander']});
 assert.equal(bankFields(text).titularConta,undefined);
 assert.equal(bankFields('Empresa com sede no Brasil. Ag 3455 Cc 130083488').banco,undefined);
 assert.equal(bankFields('Santander Empresas\nAg 3455 Cc 130083488\nPagador\nAg 1234 Cc 12345').agencia,undefined);
 assert.equal(documentSourceKind({name:'WhatsApp.jpeg',text:'Acessar conta\nAg. 3175-5 • Cc. 25427-4'}),'bank');
 assert.equal(documentSourceKind({name:'WhatsApp.jpeg',text:'Banco do Brasil\nCPF: 529.982.247-25'}),'unknown');
});

test('two independent labelled OCR passes can confirm a verified field despite low page average',()=>{
 const pass='Santander Empresas\nAg 3455 Cc 130083488';
 const reading={text:pass+'\nLEITURA ADICIONAL — PADDLEOCR / OPENCV\n'+pass,method:'OCR de imagem + PaddleOCR / OpenCV',pages:1,verifiedFields:['agencia','conta'],confidence:78};
 assert.equal(verifiedFieldEvidence(reading,'agencia','3455','bank'),true);
 assert.equal(verifiedFieldEvidence(reading,'conta','130083488','bank'),true);
 assert.equal(verifiedFieldEvidence({...reading,text:pass+'\nLEITURA ADICIONAL — PADDLEOCR / OPENCV\nAg 3456 Cc 130083488'},'agencia','3455','bank'),false);
 assert.equal(verifiedFieldEvidence({...reading,verifiedFields:[]},'agencia','3455','bank'),true,'independent labelled passes are evidence even when an old parser omitted the flag');
 assert.equal(verifiedFieldEvidence({...reading,text:pass,verifiedFields:[]},'agencia','3455','bank'),false,'one pass without the verification flag remains pending');
 assert.equal(verifiedFieldEvidence({...reading,incomplete:true},'agencia','3455','bank'),false);
});

test('bank table labels survive adjacent PDF column text without adopting the payment clause',()=>{
 const fields=fieldsFromLines(['BANCO: CORA Ocorrerá em 01 (UMA) parcela, sendo 70%','CC: 5540818-5','AG: 0001']);
 assert.deepEqual(fields.banco,['CORA']);assert.deepEqual(fields.conta,['5540818-5']);assert.deepEqual(fields.agencia,['0001']);
});

test('instrument title is not part of the company name anchored to a valid CNPJ',()=>{
 const text='CONTRATO DE GESTÃO E COBRANÇA DE RECEBÍVEIS COM GARANTIA DE PAGAMENTO E OUTORGA DE DIREITOS EMPRESA EXEMPLO LTDA, sociedade empresária limitada, cujo nome fantasia é ESCOLA EXEMPLO, inscrita no CNPJ/ME sob o nº 11.444.777/0001-61, com sede na Rua Um, 10.';
 assert.deepEqual(recoverTextFields(text,{}).razaoSocial,['EMPRESA EXEMPLO LTDA']);
});

test('cheque header separates account from serial/cheque number and identifies the printed holder',()=>{
 const text='Comp Banco Cooperativa C1 Conta\n018 756 4293 2 000165507-8 1 001 000059 0\nPague por este\nCheque a quantia de\nSICOOB PERNAMBUCO ESCOLA EXEMPLO LTDA\nCNPJ.: 11.444.777/0001-61';
 assert.deepEqual(sicoobChequeFields(text),{banco:['756'],agencia:['4293'],conta:['000165507-8'],titularConta:['ESCOLA EXEMPLO LTDA'],documentoTitular:['11.444.777/0001-61']});
 assert.deepEqual(sicoobChequeFields(text+'\n018 756 9999 2 12345678-9 1 001 000059 0'),{});
 assert.deepEqual(sicoobChequeFields('Conta 000059\nSICOOB'),{});
});
