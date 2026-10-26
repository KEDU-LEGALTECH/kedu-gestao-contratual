import {htmlToText,extractFields} from './glpi-analysis.js';
import {fieldsFromLines,normalizeValue,norm} from './processing-extract.js';

/** The form and explicitly labelled observations are the reference, never a guessed value. */
export function requestExpectations(content:string,explicitFields:Record<string,{value:string}>={}){
 const lines=htmlToText(content),form=extractFields(lines);
 const nested=['observacoes','detalhamento'].flatMap(k=>form[k]?[form[k]]:[]);
 const fields=fieldsFromLines([...lines,...nested]);
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
 return fields;
}
const states:Record<string,string>={ac:'acre',al:'alagoas',ap:'amapa',am:'amazonas',ba:'bahia',ce:'ceara',df:'distrito federal',es:'espirito santo',go:'goias',ma:'maranhao',mt:'mato grosso',ms:'mato grosso do sul',mg:'minas gerais',pa:'para',pb:'paraiba',pr:'parana',pe:'pernambuco',pi:'piaui',rj:'rio de janeiro',rn:'rio grande do norte',rs:'rio grande do sul',ro:'rondonia',rr:'roraima',sc:'santa catarina',sp:'sao paulo',se:'sergipe',to:'tocantins'};
export const sameRequestedValue=(key:string,a:string,b:string)=>{
 const canonical=(value:string)=>{
  let v=norm(normalizeValue(key,value));
  if(key==='estado')return states[v]||v;
  if(key==='endereco')v=v.replace(/^av(?:enida)?\.?\s+/,'avenida ').replace(/^r(?:ua)?\.?\s+/,'rua ').replace(/[,]+/g,' ').replace(/\s+/g,' ').trim();
  return v;
 };return canonical(a)===canonical(b);
};
