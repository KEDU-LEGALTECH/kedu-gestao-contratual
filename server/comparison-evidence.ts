import {sameRequestedValue,distinctRequestedValues} from './request-expectations.js';

/** A parenthetical maintainer is neither proof of a different entity nor
 * permission to discard the qualifier and approve the short name. */
export function qualifiedNameNeedsReview(key:string,found:string[],expected:string[]){
 if(!['razaoSocial','nomeFantasia','titularConta'].includes(key)||found.length!==1||expected.length!==1)return false;
 return [[found[0],expected[0]],[expected[0],found[0]]].some(([long,short])=>{
  const m=/^(.+?)\s*\([^()]+\)\s*$/.exec(long);
  return !!m&&sameRequestedValue(key,m[1].trim(),short)&&!sameRequestedValue(key,long,short);
 });
}

/** Header "NAME (CNPJ)" without a legal form, as in Kedu proposals and annexes: the name is
 * how the school is known commercially, so a different razão social there proves nothing. */
export function headerTradeName(text:string,value:string){
 if(/\b(?:LTDA|EIRELI|EPP|ME|MEI|S\/?A|SOCIEDADE|ASSOCIA[ÇC][ÃA]O|FUNDA[ÇC][ÃA]O|COOPERATIVA|INSTITUTO|EMPRESA INDIVIDUAL)\b\.?/i.test(value))return false;
 const fold=(s:string)=>s.normalize('NFD').replace(/\p{Diacritic}/gu,'').toUpperCase().replace(/\s+/g,' ').trim();
 const name=fold(value);
 return String(text||'').split(/\r?\n/).slice(0,40).some(line=>{const m=/^(.+?)\s*\(\s*(?:CNPJ\s*:?\s*)?[\d./-]{14,18}\s*\)\s*$/.exec(fold(line));return !!m&&m[1]===name;});
}

/** Compose only components observed together in the scoped document, never from the GLPI reference. */
export function withDocumentAddress(fields:Record<string,string[]>) {
 const streets=distinctRequestedValues('rua',fields.rua||[]),numbers=distinctRequestedValues('numero',fields.numero||[]);
 if(fields.endereco?.length||streets.length!==1||numbers.length!==1)return fields;
 return {...fields,endereco:[`${streets[0]}, ${numbers[0]}`]};
}

/** A pending OCR page does not invalidate a value already extracted from the digital layer. */
export function hasDigitalField(reading:any,key:string,value:string) {
 if(!reading.problem&&/^XLSX(?: com OCR)?$/.test(reading.method||'')&&['cnpj','razaoSocial','nomeFantasia'].includes(key)&&reading.literalIdentityFields?.[key]?.length===1&&sameRequestedValue(key,reading.literalIdentityFields[key][0],value))return true;
 if(reading.problem||(reading.formulaCount||0)>0||!['Texto do PDF','PDF com OCR','DOCX','DOCX com OCR','ODT','ODT com OCR','PPTX','PPTX com OCR','XLSX','XLSX com OCR','Texto'].includes(reading.method||''))return false;
 const fields=withDocumentAddress(reading.digitalFields||{});
 return fields[key]?.length===1&&sameRequestedValue(key,fields[key][0],value);
}

/** Page/quote recovered from the original digital layer, not an OCR guess. */
export function digitalFieldOrigin(reading:any,key:string,value:string){
 if(!hasDigitalField(reading,key,value))return undefined;
 if(reading.literalIdentityFields?.[key]?.length===1)return reading.literalIdentityOrigins?.[key]?.find((o:any)=>o.sheet&&o.excerpt&&sameRequestedValue(key,o.value,value));
 return reading.digitalFieldOrigins?.[key]?.find((o:any)=>Number.isInteger(o.page)&&o.page>=1&&sameRequestedValue(key,o.value,value));
}
