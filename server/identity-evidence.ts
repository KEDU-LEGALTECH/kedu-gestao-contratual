import {sameRequestedValue} from './request-expectations.js';
import {validCnpj} from './registration-reading.js';
import {validCpf} from './reading-validation.js';
import {structuredIdentityFields} from './structured-identities.js';
import {extractContractParties} from './contract-parties.js';
import {bankFields,bankAccountSection,sicoobChequeFields} from './bank-reading.js';
export type FieldOrigin={value:string;page:number;excerpt:string};
type IdentityReading={text:string;pages?:number;fieldOrigins?:Record<string,FieldOrigin[]>};
export function captureFieldOrigins(target:Record<string,FieldOrigin[]>,fields:Record<string,string[]>,text:string,page:number) {
 const indexes:number[]=[],characters:string[]=[];
 for(let i=0;i<text.length;i++)for(const c of text[i].normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase())if(/[a-z0-9]/.test(c)){characters.push(c);indexes.push(i);}
 const compact=characters.join('');
 for(const [key,values] of Object.entries(fields))for(const value of values){
  const needle=value.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const at=needle.length>=3?compact.indexOf(needle):-1;if(at<0)continue;
  const excerpt=text.slice(Math.max(0,indexes[at]-120),Math.min(text.length,indexes[at+needle.length-1]+160));
  if(!(target[key]||=[]).some(o=>o.page===page&&sameRequestedValue(key,o.value,value)))target[key].push({value,page,excerpt});
 }
}
/** Checks the printed identity's role; a checksum or an arbitrary occurrence is insufficient. */
export function identityEvidence(reading:IdentityReading,key:string,value:string,role:string):FieldOrigin|null {
 if(!['cnpj','representanteCpf','documentoTitular'].includes(key))return null;
 const digits=value.replace(/\D/g,''),valid=key==='cnpj'?validCnpj(value):key==='representanteCpf'?validCpf(value):digits.length===11?validCpf(value):validCnpj(value);
 if(!valid)return null;
 const compact=(s:string)=>s.replace(/\D/g,'');
 const origins=(reading.fieldOrigins?.[key]||[]).filter(o=>sameRequestedValue(key,o.value,value));
 const page=origins[0]?.page||(reading.pages===1?1:undefined);if(!page)return null;
 let evidenceText=reading.text;
 if(key==='representanteCpf'){
  const fields=structuredIdentityFields(reading.text);
  if(fields.representanteCpf?.length!==1||!sameRequestedValue(key,fields.representanteCpf[0],value))return null;
 }else if(key==='cnpj'){
  const parties=extractContractParties(reading.text);
  if(parties.length){if(parties.filter(p=>sameRequestedValue(key,p.cnpj,value)).length!==1)return null;}
  else {
   const label=role==='registration'?/(?:CNPJ|N[ÚU]MERO DE INSCRI[ÇC][ÃA]O)\s*(?:n[º°o.]?\s*)?:?\s*(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})(?!\d)/gi:/(?:^|\n)\s*CNPJ\s*(?:n[º°o.]?\s*)?:?\s*(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})(?!\d)/gi;
   const printed=[...reading.text.matchAll(label)];
   if(role==='registration'){
    // In the registration card the number starts the row immediately below the column heading.
    printed.push(...reading.text.matchAll(/(?:^|\n)[ \t]*N[ÚU]MERO DE INSCRI[ÇC][ÃA]O[^\r\n]*\r?\n[ \t]*(\d{2}\.\d{3}\.\d{3}\/\d{4}[ \t]*[.-]?[ \t]*\d{2})(?!\d)/gi));
   }
   const ids=[...new Set(printed.map(m=>compact(m[1])))];
   if(ids.length!==1||ids[0]!==digits)return null;
  }
 }else{
  const ids=[...new Set([...reading.text.matchAll(/(?:CPF\s*\/\s*CNPJ DO TITULAR|CPF DO TITULAR|CNPJ DO TITULAR|DOCUMENTO DO TITULAR)\s*:?\s*(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}|\d{3}\.?\d{3}\.?\d{3}-?\d{2})(?!\d)/gi)].map(m=>compact(m[1])))];
  if(ids.length!==1||ids[0]!==digits){
   const accountSection=bankAccountSection(reading.text),cheque=sicoobChequeFields(reading.text);
   const section=accountSection||(role==='bank'&&cheque.documentoTitular?.length===1?reading.text:'');
   const documents=accountSection?bankFields('Dados bancários\n'+section).documentoTitular||[]:cheque.documentoTitular||[];
   if(!['bank','document'].includes(role)||documents.length!==1||compact(documents[0])!==digits)return null;
   evidenceText=section;
  }
 }
 const local:Record<string,FieldOrigin[]>={};captureFieldOrigins(local,{[key]:[value]},evidenceText,page);
 const excerpt=evidenceText===reading.text?(origins[0]?.excerpt||local[key]?.[0]?.excerpt):local[key]?.[0]?.excerpt;
 return excerpt&&compact(excerpt).includes(digits)?{value,page,excerpt}:null;
}
