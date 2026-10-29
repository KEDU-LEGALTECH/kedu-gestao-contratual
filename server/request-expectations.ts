import {distinctFieldValues} from '../shared/value-comparison.js';
import {htmlToText,extractFields} from './glpi-analysis.js';
import {fieldsFromLines,normalizeValue} from './processing-extract.js';
export function requestCompanyReferences(content:string){
 return [...htmlToText(content).join('\n').matchAll(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\s*\(([^)\n]{3,180})\)/g)].map(m=>({cnpj:m[1],name:m[2].trim()}));
}

/** The form and explicitly labelled observations are the reference, never a guessed value. */
export function requestExpectations(content:string,explicitFields:Record<string,{value:string}>={}){
 const lines=htmlToText(content),form=extractFields(lines);
 const nested=['observacoes','detalhamento'].flatMap(k=>form[k]?[form[k]]:[]);
 const fields=fieldsFromLines([...lines,...nested]);
 // CNPJs with company labels in one cell are separate references, not one malformed number.
 if(fields.cnpj)fields.cnpj=fields.cnpj.flatMap(value=>{
  const ids=[...value.matchAll(/\b(?:\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{14})(?!\d)/g)].map(m=>normalizeValue('cnpj',m[0]));
  return ids.length?ids:[value];
 });
 const listed=String(form.cnpj||'').match(/\b(?:\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{14})(?!\d)/g)||[];
 const companies=requestCompanyReferences(content);
 if(listed.length>1||companies.length>1)fields.cnpj=[...(fields.cnpj||[]),...listed.map(v=>normalizeValue('cnpj',v)),...companies.map(c=>c.cnpj)];
 if(fields.razaoSocial)fields.razaoSocial=fields.razaoSocial.map(value=>value.replace(/^(?:contratante|contratad[ao])\s*:\s*|^(?:contratante|contratad[ao])\s+(?=\S+\s+\S+)/i,'').trim());
 // A CEP inside the requested address is also explicit reference evidence, not a replacement for it.
 for(const address of fields.endereco||[])for(const match of address.matchAll(/\bCEP\s*:?\s*(\d{2}\.?\d{3}-?\d{3})(?!\d)/gi))fields.cep=[...(fields.cep||[]),normalizeValue('cep',match[1])];
 // Labelled numeric values also occur together in a single observations cell.
 const text=nested.join('\n');
 for(const [key,pattern] of [
  ['valor',/\bvalor parcelado\s*:\s*((?:R\$\s*)?(?:\d{1,3}(?:\.\d{3})*|\d+),\d{2})(?!\d)/gi],
  ['remuneracao',/\bremunera[çc][ãa]o kedu\s*:\s*(\d{1,3}(?:[.,]\d{1,2})?\s*%)/gi],
  ['parcelas',/\b(?:qtd\.?|quantidade de|n[úu]mero de) parcelas\s*:\s*(\d+)(?!\d)/gi],
 ] as [string,RegExp][]){
  const matches=[...text.matchAll(pattern)].map(m=>normalizeValue(key,m[1]));
  const shape=key==='valor'?/^\d+,\d{2}$/:key==='remuneracao'?/^\d+,\d{2}%$/:/^\d+$/;
  if(matches.length)fields[key]=[...new Set([...(fields[key]||[]).filter(v=>shape.test(v)),...matches])];
 }
 for(const key of ['cnpj','razaoSocial','remuneracao'])if(!fields[key] && explicitFields[key]?.value)fields[key]=[normalizeValue(key,explicitFields[key].value)];
 return Object.fromEntries(Object.entries(fields).map(([key,values])=>[key,distinctFieldValues(key,values)]));
}
export {sameFieldValue as sameRequestedValue,distinctFieldValues as distinctRequestedValues} from '../shared/value-comparison.js';
