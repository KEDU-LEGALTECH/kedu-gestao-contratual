import {qualificationFields} from './qualification-reading.js';
import {structuredIdentityFields} from './structured-identities.js';
import {ownIdentity,plausibleFieldValue} from './field-plausibility.js';
import {bankFields} from './bank-reading.js';
import {validCnpj} from './registration-reading.js';
import {distinctRequestedValues,sameRequestedValue} from './request-expectations.js';
import {fullStateName} from '../shared/state-name.js';
import {contextualLayoutFields} from './contextual-layout-fields.js';
import {explicitContractTotals} from './explicit-contract-total.js';
type Fields=Record<string,string[]>;
export function labelledLocationExcerpt(text:string,key:string,value:string){
 if(!['cidade','estado'].includes(key))return '';
 const lines=text.split(/\r?\n/).filter(line=>/(?:Cidade|Munic[íi]pio)\s*\/\s*UF/i.test(line));
 const matches=lines.filter(line=>recoverTextFields(line,{})[key]?.some(v=>sameRequestedValue(key,v,value)));
 return matches.length===1?matches[0].trim():'';
}
/** Fields recoverable from an already extracted text without OCR; existing fields are never replaced. */
export function recoverTextFields(text:string,existing:Fields):Fields {
 const found:Fields={};
 // Labelled location is not evidence of a street, registered seat or bank owner.
 const locations=[...text.matchAll(/(?:^|\n)\s*(?:Cidade|Munic[íi]pio)\s*\/\s*UF\s*:?\s+([\p{L}][\p{L} .'-]{1,70}?)\s*\/\s*([A-Z]{2})(?=\s|$)/giu)]
  .map(m=>({city:m[1].trim(),uf:m[2].toUpperCase()})).filter(m=>!!fullStateName(m.uf));
 if(locations.length===1){found.cidade=[locations[0].city+' - '+locations[0].uf];found.estado=[fullStateName(locations[0].uf)!];}
 // Some rental addenda print the supplier only in the signature table.
 const signatures=[...text.matchAll(/(?:^|\n)[ \t]*_{8,}[ \t]{3,}_{8,}[ \t]*\r?\n[ \t]*KEDU[^\r\n]*?[ \t]{3,}([^\r\n]+)(?:\r?\n[ \t]*([^\r\n]+?))?\r?\n[ \t]*LOCAT[ÁA]RI[OA][ \t]{3,}LOCADOR[A]?[ \t]*(?:\r?\n|$)/gi)];
 if(signatures.length===1){
  const name=[signatures[0][1],signatures[0][2]].filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
  if(/\b(?:LTDA\.?|EIRELI|EPP|ME|S\s*\.\s*A\.?)$/i.test(name)&&plausibleFieldValue('razaoSocial',name))found.razaoSocial=[name];
 }
 const totals=explicitContractTotals(text);if(totals.length&&!existing.valorTotal?.some(v=>v.trim()))found.valorTotal=totals;
 for(const part of [contextualLayoutFields(text),bankFields(text),qualificationFields(text,cnpj=>ownIdentity('cnpj',cnpj))])for(const [key,values] of Object.entries(part))found[key]=distinctRequestedValues(key,[...(found[key]||[]),...values]);
 const socialNames=distinctRequestedValues('razaoSocial',[
  ...[...text.matchAll(/a\s+sociedade\s+(?:girar[áa]|adotar[áa])\s+sob\s+(?:o\s+)?nome\s+empresarial\s*[“"]([^”"\n]{5,180})[”"]/gi)].map(m=>m[1].trim()),
  ...[...text.matchAll(/a\s+(?:sociedade|empresa)\s+(?:girar[áa]|adotar[áa])\s+sob\s+(?:o\s+)?nome\s+empresarial\s*[.:]?\s*[“"]?([^”"\n]{3,160}?\b(?:LTDA|EIRELI|EPP|ME|MEI))\b/gi)].map(m=>m[1].trim()),
 ]);
 if(socialNames.length)found.razaoSocial=distinctRequestedValues('razaoSocial',[...(found.razaoSocial||[]),...socialNames]);
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
 return Object.fromEntries(Object.entries(found).filter(([key,values])=>values.length&&!existing[key]?.some(value=>plausibleFieldValue(key,value))));
}

