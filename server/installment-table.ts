import {normalizeValue,norm} from './processing-extract.js';

/** Recognises explicit simulation rows; never treats every alternative as a contracted installment count. */
export function installmentTableFields(text:string,requestedCount:string|undefined){
 const header=norm(text);
 if(!requestedCount || !/^\d+$/.test(requestedCount) || !header.includes('parcelamentos contratados') || !header.includes('remuneracao') || !header.includes('principal') || !header.includes('valor parcela'))return {} as Record<string,string[]>;
 const rows=text.split(/\r?\n/).flatMap(line=>{
  const m=/^\s*(\d{1,3}(?:[.,]\d{1,2})?\s*%)\s+(\d{1,3})\s+(R\$\s*(?:\d{1,3}(?:\.\d{3})*|\d+),\d{2})(?=\s|$)/.exec(line);
  return m && m[2]===requestedCount?[{remuneracao:normalizeValue('remuneracao',m[1]),parcelas:m[2],valor:normalizeValue('valor',m[3])}]:[];
 });
 if(!rows.length)return {};
 return Object.fromEntries(['remuneracao','parcelas','valor'].map(key=>[key,[...new Set(rows.map(r=>(r as any)[key]))]]));
}
