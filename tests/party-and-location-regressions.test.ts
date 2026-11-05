import {test} from 'node:test';import assert from 'node:assert/strict';
import {extractContractParties,scopePartyReading,selectContractParty} from '../server/contract-parties.js';
import {plausibleFieldValue} from '../server/field-plausibility.js';
import {recoverTextFields} from '../server/text-recovery.js';
import {sameFieldValue} from '../shared/value-comparison.js';
import {readingBlockers,processingStatus} from '../server/processing-status.js';
test('CPF identifies the individual contractor rather than the Kedu company',()=>{
 const text='CONTRATADO: Caio Ramos Barreto\nCPF: 06817751306\nCONTRATANTE: KEDU serv. Soluções educacionais e financeiras LTDA.\nCPF - CNPJ: 45543580000100.\nOBS: aceito por mim ( DJ Caio Barreto ), o pagamento foi programado.';
 const {reading,selected}=scopePartyReading({text,fields:{}},'06817751306');
 assert.equal(selected?.name,'Caio Ramos Barreto');assert.deepEqual(reading.fields.cnpj,['06817751306']);assert.deepEqual(reading.fields.razaoSocial,['DJ Caio Barreto']);
 assert.equal(plausibleFieldValue('cnpj','06817751306'),true);assert.equal(plausibleFieldValue('cnpj','06817751307'),false);
});
test('representative CPF does not replace a corporate party CNPJ',()=>{
 const p=extractContractParties('CONTRATADA: KEDU LTDA\nCNPJ: 45.543.580/0001-00\nrepresentante CPF: 06817751306');assert.equal(p[0].cnpj,'45.543.580/0001-00');assert.equal(p[0].aliases,undefined);
 assert.equal(extractContractParties('CONTRATADA: ALFA LTDA\nRepresentante: Maria Silva\nCPF: 06817751306').length,0);
});
test('a wrapped legal suffix is one entity across repeated declarations',()=>{
 const text='CONTRATADA: UNIMED FORTALEZA SOCIEDADE COOPERATIVA MÉDICA\nLTDA., inscrita no CNPJ sob o nº 05.868.278/0001-07\nCONTRATANTE: KEDU LTDA, CNPJ 45.543.580/0001-00\nCONTRATADA: UNIMED FORTALEZA SOCIEDADE COOPERATIVA MÉDICA LTDA., CNPJ 05.868.278/0001-07';
 const parties=extractContractParties(text);assert.equal(parties.length,2);assert.match(selectContractParty(parties,'05.868.278/0001-07')!.name,/LTDA/);
});
test('different names sharing an identifier are not silently merged',()=>{
 const parties=extractContractParties('CONTRATADA: ALFA LTDA, CNPJ 05.868.278/0001-07\nCONTRATADA: BETA LTDA, CNPJ 05.868.278/0001-07');assert.equal(selectContractParty(parties,'05.868.278/0001-07'),null);
});
test('Cidade/UF table is read without inferring a registered address',()=>{
 const f=recoverTextFields('CNPJ 23.050.490/0002-17\nCidade/UF   Candeias/BA   Faturamento Mensal (R$) -',{});
 assert.deepEqual(f.cidade,['Candeias - BA']);assert.deepEqual(f.estado,['Estado da Bahia']);assert.equal(f.endereco,undefined);assert.equal(f.razaoSocial,undefined);
 assert(sameFieldValue('cidade','Candeias/BA','Candeias - BA'));assert(!sameFieldValue('cidade','Candeias/BA','Candeias - MG'));
});
test('multiple location rows and an unknown UF are not selected arbitrarily',()=>{
 assert.equal(recoverTextFields('Cidade/UF Candeias/BA\nCidade/UF Salvador/BA',{}).cidade,undefined);assert.equal(recoverTextFields('Cidade/UF Candeias/XX',{}).cidade,undefined);
});
test('structural reading blockers remain visible independently of matching fields',()=>{
 const issues=[{field:'review:parties:abc'},{field:'template'}];assert.equal(readingBlockers(issues).length,1);assert.equal(processingStatus(issues,[{status:'matches'},{status:'matches'}]),'Aguardando análise');assert.equal(processingStatus([{field:'template'}],[{status:'matches'}]),'Sem erros');
});

