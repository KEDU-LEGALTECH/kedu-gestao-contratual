import {fieldsFromLines,extractProcessingFile} from './processing-extract.js';
import {recoverTextFields} from './text-recovery.js';
import {positionedRows} from './table-reading.js';
import {needsPdfOcr} from './pdf-reading-policy.js';
import {captureFieldOrigins,type FieldOrigin} from './identity-evidence.js';
import {distinctRequestedValues} from './request-expectations.js';
import {withDocumentAddress} from './comparison-evidence.js';
import PizZip from 'pizzip';
import {literalSpreadsheetIdentity,readSpreadsheet} from './xlsx-reading.js';

export type DigitalRecovery={text:string;fields:Record<string,string[]>;fieldOrigins:Record<string,FieldOrigin[]>;pages:number;pendingPages:number[];literalIdentityFields?:Record<string,string[]>;literalIdentityOrigins?:Record<string,unknown[]>};
/** Original native text only; no rendering, OCR, network, GLPI values or approval. */
export async function recoverDigitalOriginal(bytes:Buffer,name:string):Promise<DigitalRecovery>{
 const fields:Record<string,string[]>={},fieldOrigins:Record<string,FieldOrigin[]>={},texts:string[]=[],pendingPages:number[]=[];
 if(/\.xlsx$/i.test(name)){
  const zip=new PizZip(bytes),identity=literalSpreadsheetIdentity(zip),sheet=readSpreadsheet(zip);
  return {text:sheet.text,fields:identity.fields,fieldOrigins:{},pages:0,pendingPages:[],literalIdentityFields:identity.fields,literalIdentityOrigins:identity.origins};
 }
 const add=(text:string,page:number)=>{
  texts.push(text);
  const parsed=fieldsFromLines(text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean));
  const recovered=recoverTextFields(text,{});
  const pageFields=withDocumentAddress(Object.fromEntries([...new Set([...Object.keys(parsed),...Object.keys(recovered)])].map(key=>[key,distinctRequestedValues(key,[...(parsed[key]||[]),...(recovered[key]||[])])])));
  for(const [key,values] of Object.entries(pageFields))fields[key]=distinctRequestedValues(key,[...(fields[key]||[]),...values]);
  captureFieldOrigins(fieldOrigins,pageFields,text,page);
 };
 if(/\.docx$/i.test(name)){
  const reading=extractProcessingFile(bytes,name);add(reading.text,1);
  // Embedded image content is not inspected by this native-text pass.
  return {text:texts.join('\n'),fields,fieldOrigins,pages:1,pendingPages:[1]};
 }
 if(!/\.pdf$/i.test(name))throw Error('Recuperação digital aceita PDF e DOCX.');
 const {getDocument,OPS}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const task=getDocument({data:new Uint8Array(bytes),verbosity:0});
 try{
  const pdf=await task.promise;if(pdf.numPages>200)throw Error('PDF acima de 200 páginas; preserve a leitura anterior.');
  for(let i=1;i<=pdf.numPages;i++){
   const page=await pdf.getPage(i);
   try{
    const content=await page.getTextContent();
    const text=positionedRows(content.items as any).map(row=>row.join(' ')).join('\n');
    add(text,i);
    const ops=await page.getOperatorList();const view=page.getViewport({scale:1});
    if(needsPdfOcr(text,ops,OPS,view.width*view.height))pendingPages.push(i);
    if(texts.reduce((n,t)=>n+t.length,0)>2_000_000)throw Error('Texto digital acima do limite; preserve a leitura anterior.');
   }finally{page.cleanup();}
  }
  return {text:texts.join('\n\n'),fields,fieldOrigins,pages:pdf.numPages,pendingPages};
 }finally{await task.destroy();}
}
