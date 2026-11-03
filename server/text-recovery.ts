import {qualificationFields} from './qualification-reading.js';
import {structuredIdentityFields} from './structured-identities.js';
import {ownIdentity} from './field-plausibility.js';
import {bankFields} from './bank-reading.js';
import {validCnpj} from './registration-reading.js';
import {distinctRequestedValues} from './request-expectations.js';
import {fullStateName} from '../shared/state-name.js';
import {contextualLayoutFields} from './contextual-layout-fields.js';
type Fields=Record<string,string[]>;
/** Fields recoverable from an already extracted text without OCR; existing fields are never replaced. */
export function recoverTextFields(text:string,existing:Fields):Fields {
 const found:Fields={};
 for(const part of [contextualLayoutFields(text),bankFields(text),qualificationFields(text,cnpj=>ownIdentity('cnpj',cnpj))])for(const [key,values] of Object.entries(part))found[key]=distinctRequestedValues(key,[...(found[key]||[]),...values]);
 const socialNames=distinctRequestedValues('razaoSocial',[...text.matchAll(/a\s+sociedade\s+(?:girar[áa]|adotar[áa])\s+sob\s+(?:o\s+)?nome\s+empresarial\s*[“"]([^”"\n]{5,180})[”"]/gi)].map(m=>m[1].trim()));
 if(socialNames.length===1)found.razaoSocial=socialNames;
 const seats=[...text.matchAll(/a\s+sociedade\s+ter[áa]\s+sua\s+sede\s+(?:na|no|em)\s+([\s\S]{8,240}?\bCEP\s*:?\s*\d{2}\.?\d{3}-?\d{3})/gi)].map(m=>m[1].replace(/\s+/g,' ').trim());
 if(seats.length===1){
  const address=seats[0].replace(/^seguinte\s+endere[çc]o\s*:\s*/i,'');found.endereco=[address];
  const cep=/\bCEP\s*:?\s*(\d{2}\.?\d{3}-?\d{3})\b/i.exec(address)?.[1]?.replace(/\D/g,'');
  if(cep)found.cep=[cep.slice(0,5)+'-'+cep.slice(5)];
  const city=/,\s*([\p{L}][\p{L} '\-]{1,65}),\s*([A-Z]{2})\s*,?\s*CEP\b/iu.exec(address);
  if(city&&fullStateName(city[2])){found.cidade=[city[1].trim()];found.estado=[fullStateName(city[2])!];}
 }
 // Registry covers use Empresa:, not the contract's Razão social: label.
 if(/junta\s+comercial/i.test(text)){
  const names=distinctRequestedValues('razaoSocial',[...text.matchAll(/(?:^|\n)\s*Empresa\s*:\s*([^\n]{5,200})/gi)].map(m=>m[1].trim()));
  const ids=distinctRequestedValues('cnpj',[...text.matchAll(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g)].map(m=>m[0]).filter(v=>validCnpj(v)&&!ownIdentity('cnpj',v)));
  if(names.length===1&&ids.length===1){found.razaoSocial=names;found.cnpj=ids;}
 }
 for(const [key,values] of Object.entries(structuredIdentityFields(text)))found[key]=[...new Set([...(found[key]||[]),...values])];
 return Object.fromEntries(Object.entries(found).filter(([key,values])=>values.length&&!existing[key]?.length));
}
