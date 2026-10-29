import {sameRequestedValue,distinctRequestedValues} from './request-expectations.js';

/** Compose only components observed together in the scoped document, never from the GLPI reference. */
export function withDocumentAddress(fields:Record<string,string[]>) {
 const streets=distinctRequestedValues('rua',fields.rua||[]),numbers=distinctRequestedValues('numero',fields.numero||[]);
 if(fields.endereco?.length||streets.length!==1||numbers.length!==1)return fields;
 return {...fields,endereco:[`${streets[0]}, ${numbers[0]}`]};
}

/** A pending OCR page does not invalidate a value already extracted from the digital layer. */
export function hasDigitalField(reading:any,key:string,value:string) {
 if(reading.problem||(reading.formulaCount||0)>0||!['Texto do PDF','PDF com OCR','DOCX','DOCX com OCR','ODT','ODT com OCR','PPTX','PPTX com OCR','XLSX','XLSX com OCR','Texto'].includes(reading.method||''))return false;
 const fields=withDocumentAddress(reading.digitalFields||{});
 return fields[key]?.length===1&&sameRequestedValue(key,fields[key][0],value);
}
