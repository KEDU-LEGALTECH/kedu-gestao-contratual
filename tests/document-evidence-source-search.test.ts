import {test} from 'node:test';
import assert from 'node:assert/strict';
import {documentSourceKind,missingFieldEvidence} from '../server/document-evidence.js';
import {processingStatus} from '../server/processing-status.js';

test('identificar fonte não confere campo nem altera entrada ou aprova processamento',()=>{
 const files=Object.freeze([Object.freeze({name:'Contrato social.pdf',text:'Agência: 1234'})]);
 const before=JSON.stringify(files);
 const evidence=missingFieldEvidence('agencia',[...files]);
 assert.equal(evidence.reason,'not_located');
 const comparison={status:'missing',missingReason:evidence.reason};
 assert.equal(processingStatus([],[comparison]),'Aguardando análise');
 assert.equal(JSON.stringify(files),before);
 assert.equal('status' in evidence,false);
 assert.equal('value' in evidence,false);
});
test('contrato continua fonte possível sem afirmar presença do campo',()=>{
 const evidence=missingFieldEvidence('documentoTitular',[{name:'Contrato.pdf',text:'CONTRATO\nCNPJ: 00.000.000/0000-00'}]);
 assert.equal(evidence.reason,'not_located');
 assert.deepEqual(evidence.sourceDocuments,['Contrato.pdf']);
});

// Fixtures inteiramente sintéticas: não representam documentos ou pessoas reais.
const labeledSources:[string,string,string][]=[
 ['razaoSocial','Comprovante bancário.pdf','Razão social: EMPRESA EXEMPLO LTDA'],
 ['nomeFantasia','Contrato social.pdf','Nome fantasia: ESCOLA EXEMPLO'],
 ['cnpj','Proposta.pdf','CNPJ: 00.000.000/0000-00'],
 ['banco','Contrato social.pdf','Banco: BANCO EXEMPLO'],
 ['conta','Contrato social.pdf','Conta corrente: 12345-6'],
 ['titularConta','Contrato social.pdf','Titular da conta: EMPRESA EXEMPLO LTDA'],
 ['documentoTitular','Contrato social.pdf','CNPJ do titular da conta: 00.000.000/0000-00'],
 ['pix','Contrato social.pdf','Chave Pix: exemplo@invalid.test'],
 ['valorTotal','Contrato social.pdf','Valor total: R$ 100,00'],
 ['valorParcela','Contrato social.pdf','Valor da parcela: R$ 10,00'],
 ['parcelas','Contrato social.pdf','Número de parcelas: 10'],
 ['remuneracao','Contrato social.pdf','Remuneração: 2%'],
 ['repasse','Contrato social.pdf','Repasse: R$ 100,00'],
 ['representanteNome','Proposta.pdf','Representante legal: PESSOA EXEMPLO'],
 ['representanteCpf','Proposta.pdf','CPF do representante legal: 000.000.000-00'],
 ['razaoSocial','anexo.txt','Razão social: EMPRESA EXEMPLO LTDA'],
];
for(const [field,name,text] of labeledSources){
 test(`rótulo de ${field} identifica fonte em ${name}`,()=>{
  const evidence=missingFieldEvidence(field,[{name,text}]);
  assert.equal(evidence.reason,'not_located');
  assert.deepEqual(evidence.sourceDocuments,[name]);
 });
}
test('contexto, narrativa e rótulo vazio não identificam outro campo',()=>{
 for(const [field,text] of [
  ['documentoTitular','CNPJ: 00.000.000/0000-00'],
  ['razaoSocial','Nome fantasia: ESCOLA EXEMPLO'],
  ['agencia','O comprovante com agência e conta será enviado posteriormente.'],
  ['agencia','Agência:\nConta: 12345-6'],
  ['agencia','Agência: será informada posteriormente'],
  ['agencia','Agência: não informada'],
  ['agencia','Agência: ---'],
  ['representanteCpf','CPF do sócio: 000.000.000-00'],
 ] as const){
  const name=field==='razaoSocial'?'Comprovante bancário.pdf':field==='representanteCpf'?'Proposta.pdf':'Contrato social.pdf';
  const evidence=missingFieldEvidence(field,[{name,text}]);
  assert.equal(evidence.reason,'not_sent',`${field}: ${text}`);
  assert.deepEqual(evidence.sourceDocuments,[]);
 }
});
for(const [flag,expected] of [['downloadFailed','download_failed'],['downloadPending','download_pending'],['problem','read_failed'],['incomplete','partial']] as const){
 test(`anexo de outro tipo com ${flag} não comprova ausência`,()=>{
  const result=missingFieldEvidence('agencia',[{name:'Contrato social.pdf',[flag]:flag==='problem'?'Leitor indisponível':true}]);
  assert.equal(result.reason,expected);
 });
}
test('busca fonte pelo rótulo explícito mesmo em tipo reconhecido não preferencial',()=>{
 const file={name:'Contrato social.pdf',text:'CONTRATO SOCIAL\nAgência: 1234\nConta: 56789-0'};
 assert.equal(documentSourceKind(file),'social');
 const result=missingFieldEvidence('agencia',[file]);
 assert.equal(result.reason,'not_located');
 assert.deepEqual(result.sourceDocuments,[file.name]);
 assert.deepEqual(Object.keys(result).sort(),['expectedDocument','message','reason','sourceDocuments']);
});
