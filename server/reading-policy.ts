import {receivedDocumentKind} from '../shared/document-heading.js';
import {sameRequestedValue} from './request-expectations.js';
import {editableKeys} from './processing-extract.js';
import {documentSourceKind} from './document-evidence.js';
import {distinctiveValue} from './field-plausibility.js';
/** Keep explicitly labelled fields omitted by the preferred OCR pass, without replacing conflicts. */
export function complementaryOcrFields(preferred:Record<string,string[]>,other:Record<string,string[]>,confidence:number) {
 if(confidence<85)return {};
 return Object.fromEntries(Object.entries(other).filter(([key,values])=>!preferred[key]?.length&&values.length===1));
}
export function attachmentRole(name:string,text='') {
 const s=(name+'\n'+text.slice(0,2000)).normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/_/g,' ');
 if(receivedDocumentKind(name,text)==='Contraproposta')return 'counterproposal';
 if(receivedDocumentKind(name,text)==='Relatório')return 'report';
 const sourceKind=documentSourceKind({name,text});
 if(sourceKind==='registration'||sourceKind==='bank')return sourceKind;
 if(/proposta de antecipacao|simulacao|parcelamentos contratados/.test(s))return 'simulation';
 return 'document';
}
export function fieldsForRole(role:string,fields:Record<string,string[]>) {
 if(['counterproposal','report'].includes(role))return {};
 const permitted=role==='registration'?['cnpj','razaoSocial','nomeFantasia','endereco','rua','numero','bairro','cep','cidade','estado']:role==='bank'?['banco','agencia','conta','titularConta','documentoTitular','pix']:null;
 return permitted?Object.fromEntries(Object.entries(fields).filter(([key])=>permitted.includes(key))):fields;
}
export function interruptedReading<T extends {text:string;needsReview:boolean;warnings?:string[]}>(partial:T,message:string):T {
 return {...partial,needsReview:true,incomplete:true,warnings:[...(partial.warnings||[]),message]};
}
/** Verifies extraction only; never grants legal approval or ignores missing data. */
export function automaticReadingCheck(reading:{text:string;fields:Record<string,string[]>;method?:string;problem?:string;incomplete?:boolean;formulaCount?:number;verifiedFields?:string[];digitalFields?:Record<string,string[]>},role:string,reference:Record<string,string[]>) {
 if(!reading.text.trim()||reading.problem||reading.incomplete||['simulation','counterproposal','report'].includes(role))return false;
 if((reading.formulaCount||0)>0)return false;
 if(reading.method==='XLSX')return reading.formulaCount===0;
 const adopted=fieldsForRole(role,reading.fields);
 if(['PDF com OCR','DOCX com OCR','ODT com OCR','PPTX com OCR','XLSX com OCR'].includes(reading.method||'')&&Object.keys(adopted).length&&reading.digitalFields){
  const allDigital=Object.entries(adopted).every(([key,values])=>values.length>0&&values.every(value=>(reading.digitalFields![key]||[]).some(digital=>sameRequestedValue(key,value,digital))));
  if(allDigital)return true;
 }
 const fields=fieldsForRole(role,reading.fields);
 const expected=fieldsForRole(role,Object.fromEntries(Object.entries(reference).filter(([key])=>editableKeys.includes(key)&&!['motivo','matriz'].includes(key))));
 const keys=Object.keys(fields);
 // Independent agreement: a distinctive recognised value identical to the request was read correctly.
 // Values the request does not mention, or that differ from it, still need a person.
 if(/OCR/.test(reading.method||'')&&keys.length&&keys.every(key=>expected[key]?.length===1&&fields[key].length>0&&fields[key].every(value=>distinctiveValue(key,value)&&sameRequestedValue(key,value,expected[key][0]))))return true;
 if(!/OCR/.test(reading.method||'')||!reading.verifiedFields?.length)return false;
 const addressParts=['rua','numero','bairro'];
 const addressChecked=fields.endereco?.length===1&&expected.endereco?.length===1&&sameRequestedValue('endereco',fields.endereco[0],expected.endereco[0])&&addressParts.every(key=>fields[key]?.length===1&&reading.verifiedFields!.includes(key))&&sameRequestedValue('endereco',fields.endereco[0],fields.rua[0]+', '+fields.numero[0]+', '+fields.bairro[0]);
 // Validate the fields actually supplied by this attachment. Missing requested
 // fields remain separate blocking issues in the demand comparison.
 if(!keys.length||!Object.keys(expected).length)return false;
 return keys.every(key=>reading.verifiedFields!.includes(key)&&fields[key].length===1&&((addressChecked&&addressParts.includes(key))||(expected[key]?.length===1&&sameRequestedValue(key,fields[key][0],expected[key][0]))));
}
