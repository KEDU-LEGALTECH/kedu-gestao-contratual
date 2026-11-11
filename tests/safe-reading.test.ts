import {test} from 'node:test';
import assert from 'node:assert/strict';
import {needsReadingRecovery,preservePreviousReading} from '../server/reading-recovery-policy.js';
import {automaticReadingCheck} from '../server/reading-policy.js';
import {captureFieldOrigins,identityEvidence} from '../server/identity-evidence.js';

test('registration card associates the CNPJ even when OCR replaces its hyphen with a space',()=>{
 const text='NÚMERO DE INSCRIÇÃO   DATA DE ABERTURA\n65.836.998/0001 04 COMPROVANTE DE INSCRIÇÃO\nMATRIZ CADASTRAL';
 assert.equal(identityEvidence({text,pages:1},'cnpj','65.836.998/0001-04','registration')?.page,1);
 assert.equal(identityEvidence({text:text.replace('0001 04','0001.04'),pages:1},'cnpj','65.836.998/0001-04','registration')?.page,1);
 assert.equal(identityEvidence({text,pages:1},'cnpj','65.836.998/0001-04','document'),null);
 assert.equal(identityEvidence({text:text+'\nCNPJ 11.444.777/0001-61',pages:1},'cnpj','65.836.998/0001-04','registration'),null);
});
test('version alone never schedules successful readings; faults, partials and empty fields do',()=>{
 const extracted=JSON.stringify({version:1,text:'CNPJ legível',fields:{cnpj:['11.444.777/0001-61']}});
 assert.equal(needsReadingRecovery({byteLength:100,problem:'',extracted}),false);
 for(const delta of [{incomplete:true},{problem:'falha'},{transient:true},{fields:{},text:''}])assert.equal(needsReadingRecovery({byteLength:100,extracted:JSON.stringify({...JSON.parse(extracted),...delta})}),true);
 assert.equal(needsReadingRecovery(undefined),true);
 assert.equal(needsReadingRecovery({byteLength:100,extracted:JSON.stringify({...JSON.parse(extracted),fields:{},text:'Contrato sem dados rotulados'})}),false);
 assert.equal(preservePreviousReading(extracted,{transient:true}),true);
 assert.equal(preservePreviousReading(extracted,{problem:'Arquivo inválido'}),false);
});
test('only valid and labelled identities can be confirmed by matching GLPI',()=>{
 const fields={cnpj:['11.444.777/0001-61']};
 const reading={text:'CNPJ: 11.444.777/0001-61',method:'OCR de imagem',pages:1,fields};
 assert.equal(automaticReadingCheck(reading,'document',fields),true);
 assert.equal(automaticReadingCheck({...reading,text:'Número impresso: 11.444.777/0001-61'},'document',fields),false);
 assert.equal(automaticReadingCheck({...reading,incomplete:true},'document',fields),false);
 for(const [key,value] of Object.entries({razaoSocial:'Escola Teste',cidade:'Itaguaí',cep:'23815-550',conta:'681467862'}))assert.equal(automaticReadingCheck({...reading,text:key+': '+value,fields:{[key]:[value]},verifiedFields:[key]},'document',{[key]:[value]}),false);
});
test('CPF of witness is not accepted as representative; explicit proxy and page evidence are accepted',()=>{
 const value='529.982.247-25';
 assert.equal(identityEvidence({text:'TESTEMUNHA: Maria da Silva, CPF: '+value,pages:1},'representanteCpf',value,'document'),null);
 const text='OUTORGADO: MARIA DA SILVA, CPF: '+value;
 assert.equal(identityEvidence({text,pages:1},'representanteCpf',value,'document')?.page,1);
 const origins:Record<string,any[]>={};captureFieldOrigins(origins,{representanteCpf:[value]},text,3);
 assert.equal(identityEvidence({text,pages:4,fieldOrigins:origins},'representanteCpf',value,'document')?.page,3);
 assert.equal(identityEvidence({text,pages:4},'representanteCpf',value,'document'),null);
});
