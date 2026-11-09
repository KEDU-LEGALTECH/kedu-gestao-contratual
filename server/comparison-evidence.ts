import {sameRequestedValue,distinctRequestedValues} from './request-expectations.js';
import {repricingSchoolName} from './contextual-layout-fields.js';
import {reportIdentity} from './comparison-profile.js';

/** A possible typo in the requested legal-form suffix is a reference question,
 * never permission to silently repair the name or demand a document correction. */
export function legalFormReferenceNeedsReview(key:string,found:string[],expected:string[]){
 if(key!=='razaoSocial'||found.length!==1||expected.length!==1)return false;
 const tokens=(s:string)=>s.normalize('NFD').replace(/\p{Diacritic}/gu,'').toUpperCase().replace(/[.,]/g,'').trim().split(/\s+/);
 const a=tokens(found[0]),b=tokens(expected[0]);
 if(a.length<3||a.length!==b.length||a.slice(0,-1).join(' ')!==b.slice(0,-1).join(' '))return false;
 const actual=a.at(-1)!,reference=b.at(-1)!,forms=['LTDA','EIRELI','EPP','ME','MEI'];
 if(!forms.includes(actual)||forms.includes(reference)||!/^[A-Z]{2,9}$/.test(reference)||Math.abs(actual.length-reference.length)!==1)return false;
 const longer=actual.length>reference.length?actual:reference,shorter=actual.length>reference.length?reference:actual;
 return [...longer].some((_,i)=>longer.slice(0,i)+longer.slice(i+1)===shorter);
}

/** A commercial-name reference is not proof that the documented legal name is wrong.
 * This only requests association/review and never declares the names equivalent. */
export function referenceTradeNameNeedsReview(key:string,found:string[],expected:string[],expectedCnpj:string[],fields:Record<string,string[]>){
 if(key!=='razaoSocial'||found.length!==1||expected.length!==1||expectedCnpj.length!==1||fields.cnpj?.length!==1||fields.nomeFantasia?.length!==1)return false;
 if(!sameRequestedValue('cnpj',fields.cnpj[0],expectedCnpj[0])||sameRequestedValue(key,found[0],expected[0]))return false;
 const fold=(s:string)=>s.normalize('NFD').replace(/\p{Diacritic}/gu,'').toUpperCase().replace(/[^A-Z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
 const trade=fold(fields.nomeFantasia[0]),reference=fold(expected[0]);
 return reference.length>=4&&(trade===reference||trade.startsWith(reference+' '));
}

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
 const school=repricingSchoolName(text||'');
 if(school&&sameRequestedValue('razaoSocial',school,value))return true;
 if(/\b(?:LTDA|EIRELI|EPP|ME|MEI|S\/?A|SOCIEDADE|ASSOCIA[ÇC][ÃA]O|FUNDA[ÇC][ÃA]O|COOPERATIVA|INSTITUTO|EMPRESA INDIVIDUAL)\b\.?/i.test(value))return false;
 // A settlement summary names the school as it is known (often an abbreviation) above its CNPJ.
 const report=reportIdentity(text||'');
 if(report?.razaoSocial&&sameRequestedValue('razaoSocial',report.razaoSocial,value))return true;
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
