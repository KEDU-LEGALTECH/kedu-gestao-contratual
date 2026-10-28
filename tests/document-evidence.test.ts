import {test} from 'node:test';
import assert from 'node:assert/strict';
import {missingFieldEvidence,documentSourceKind} from '../server/document-evidence.js';
import {structuredIdentityFields} from '../server/structured-identities.js';
import {validateReadings,validCpf} from '../server/reading-validation.js';
import {withinBudget} from '../server/ocr-budget.js';
import {partialReadingRetryDue} from '../server/reading-retry.js';
test('partial pages retry with a cooldown and a finite attempt limit',()=>{
 assert.equal(partialReadingRetryDue(true,undefined),true);
 assert.equal(partialReadingRetryDue(true,{attempts:1,at:new Date().toISOString()}),false);
 assert.equal(partialReadingRetryDue(true,{attempts:3,at:'2020-01-01'}),false);
 assert.equal(partialReadingRetryDue(false,undefined),false);
});
test('absence, inaccessible source, unidentified attachment and missing value remain distinct',()=>{
 assert.equal(missingFieldEvidence('representanteCpf',[]).reason,'not_sent');
 assert.equal(missingFieldEvidence('representanteCpf',[{name:'Comprovante bancário.pdf'}]).reason,'not_sent');
 assert.equal(missingFieldEvidence('representanteCpf',[{name:'foto.png',problem:'falha'}]).reason,'source_unidentified');
 assert.equal(missingFieldEvidence('representanteCpf',[{name:'Contrato social.pdf',incomplete:true}]).reason,'unreadable');
 assert.equal(missingFieldEvidence('representanteCpf',[{name:'Contrato social.docx',text:'Conteúdo legível'}]).reason,'not_located');
 assert.equal(documentSourceKind({name:'procuração.pdf'}),'proxy');
});
test('representative identity comes from explicit authority clauses, not a list of partners',()=>{
 assert.deepEqual(structuredIdentityFields('Representada neste ato por MARIA DA SILVA, brasileira, inscrita no CPF nº 529.982.247-25.'),{representanteNome:['MARIA DA SILVA'],representanteCpf:['529.982.247-25']});
 assert.deepEqual(structuredIdentityFields('OUTORGADO: JOAO DA SILVA, CPF: 52998224725.'),{representanteNome:['JOAO DA SILVA'],representanteCpf:['529.982.247-25']});
 assert.deepEqual(structuredIdentityFields('SÓCIO: MARIA DA SILVA, CPF: 529.982.247-25.'),{});
 assert.deepEqual(structuredIdentityFields('Representada pela sócia administradora MARIA DA SILVA, CPF/MF sob o n.º 529.982.247-25.'),{representanteNome:['MARIA DA SILVA'],representanteCpf:['529.982.247-25']});
});
test('checksums, dates, instalments and document consistency are checked independently from GLPI',()=>{
 assert.equal(validCpf('529.982.247-25'),true);assert.equal(validCpf('000.000.000-00'),false);
 const findings=validateReadings([{name:'contrato',fields:{representanteCpf:['000.000.000-00'],inicio:['2026-02-30'],valorParcela:['100,00'],parcelas:['3'],valorTotal:['400,00'],cnpj:['11.444.777/0001-61'],cep:['60000-000'],cidade:['Fortaleza']}},{name:'banco',fields:{documentoTitular:['00.817.900/0001-26'],cep:['60000-000'],cidade:['Recife']}}]);
 for(const field of ['representanteCpf','inicio','valorTotal','documentoTitular','cidade'])assert.ok(findings.some(f=>f.field===field),field);
 assert.deepEqual(validateReadings([{name:'proposta',fields:{valorParcela:['100,00'],parcelas:['3'],valorTotal:['300,00'],representanteCpf:['529.982.247-25']}}]),[]);
});
test('page deadline releases work and calls cancellation rather than blocking following pages',async()=>{
 let cancelled=false;await assert.rejects(withinBudget(()=>new Promise(()=>{}),5,()=>{cancelled=true;}),/Tempo/);
 assert.equal(cancelled,true);assert.equal(await withinBudget(async()=>42,100,()=>{}),42);
});
