import {test} from 'node:test';import assert from 'node:assert/strict';
import {extractContractParties,scopePartyReading,selectContractParty} from '../server/contract-parties.js';

test('CNPJ de outra escola não substitui o da escola indicada pelo nome',()=>{
 const parties=extractContractParties('CONTRATADA: ESCOLA ALFA LTDA, CNPJ 31.679.749/0001-30\nCONTRATADA: ESCOLA BETA LTDA, CNPJ 04.185.080/0001-58');
 assert.equal(selectContractParty(parties,'04.185.080/0001-58','ESCOLA ALFA LTDA')?.cnpj,'31.679.749/0001-30');
});
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
test('a running preamble keeps the school and supplier qualifications separate',()=>{
 const school='CENTRO EDUCACIONAL EXEMPLO LTDA - COLÉGIO EXEMPLO, com sede na Rua A, inscrita no CNPJ/MF sob nº 61.060.246/0001-43, neste ato representada por seus representantes (“COLÉGIO”)';
 const supplier='SISTEMAS DE ENSINO EXEMPLO S.A., sociedade anônima, inscrita no CNPJ/MF sob o nº 49.323.314/0001-14';
 const fields={razaoSocial:['CENTRO EDUCACIONAL EXEMPLO LTDA - COLÉGIO EXEMPLO','SISTEMAS DE ENSINO EXEMPLO S.A.'],cnpj:['61.060.246/0001-43','49.323.314/0001-14']};
 for(const text of [
  `Pelo presente instrumento particular (“Aditivo”), as Partes\n${school};\n${supplier};\nConsiderando que:`,
  `O presente contrato é celebrado entre, de um lado:\n1. ${supplier};\nE de outro lado,\n2. ${school};`,
  `Pelo presente Contrato particular, de um lado ${supplier};\nE, de outro lado, ${school.replace('EXEMPLO,','EXEMPLO (“CONTRATANTE”),')};`,
 ]){
  const scoped=scopePartyReading({text,fields},'61.060.246/0001-43');
  assert.equal(scoped.parties.length,2);
  assert.deepEqual(scoped.reading.fields.razaoSocial,['CENTRO EDUCACIONAL EXEMPLO LTDA']);
  assert.deepEqual(scoped.reading.fields.cnpj,['61.060.246/0001-43']);
  if(scoped.reading.fields.rua)assert.deepEqual(scoped.reading.fields.rua,['Rua A']);
  assert.match(scoped.selected!.excerpt,/61\.060\.246\/0001-43/);
  const unmatched=scopePartyReading({text,fields},'05.868.278/0001-07');
  assert.equal(unmatched.selected,null);
  assert.deepEqual(unmatched.reading.fields,{});
 }
 assert.deepEqual(extractContractParties(`O contrato menciona ${school}; ${supplier};`),[]);
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

