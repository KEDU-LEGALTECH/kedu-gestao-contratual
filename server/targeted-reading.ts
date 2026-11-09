import {createHash} from 'node:crypto';
import {missingFieldEvidence} from './document-evidence.js';
import {sameRequestedValue} from './request-expectations.js';
import {plausibleFieldValue} from './field-plausibility.js';
import {fieldExcerpt} from './reading-guidance.js';
type Target={page:number;fields:string[];signature:string};
export const targetedReadingVersion=1;
/** No guessed crop, expected value or reference text is sent to OCR. */
export function targetedReadingTargets(name:string,reading:any,comparisons:any[],protectedFields:string[]=[],reader='ocr'):Target[]{
 if(reading.problem||reading.incomplete||reading.decorative||!/\.(pdf|png|jpe?g|webp|tiff?|bmp|gif)$/i.test(name))return [];
 const pages=new Map<number,Set<string>>();
 for(const c of comparisons){
  if(!['missing','review'].includes(c.status)||protectedFields.includes(c.field)||c.partlyMatches||['conflicting_values','trade_name','qualified_name','spreadsheet_calculation','invalid_identifier'].includes(c.reviewReason?.code))continue;
  const belongs=String(c.source||'').includes(name)||c.sourceDocuments?.includes(name)||!['not_sent','source_unidentified'].includes(missingFieldEvidence(c.field,[{name,text:reading.text||''}]).reason);
  if(!belongs)continue;
  const origins=[...(reading.fieldOrigins?.[c.field]||[]),...(reading.digitalFieldOrigins?.[c.field]||[])];
  const candidates=origins.map((o:any)=>o.page);
  if(!candidates.length&&(reading.pages===1||/\.(png|jpe?g|webp|bmp)$/i.test(name)))candidates.push(1);
  for(const page of candidates){
   if(!Number.isInteger(page)||page<1||page>200||reading.pages&&page>reading.pages)continue;
   if(!pages.has(page))pages.set(page,new Set());pages.get(page)!.add(c.field);
  }
 }
 return [...pages].sort(([a],[b])=>a-b).map(([page,keys])=>{
  const fields=[...keys].sort();
  const signature=createHash('sha256').update(JSON.stringify(reader==='ocr'?[targetedReadingVersion,page,fields]:[targetedReadingVersion,reader,page,fields])).digest('hex');
  return {page,fields,signature};
 }).filter(t=>!(reading.targetedAttempts||[]).some((a:any)=>a.signature===t.signature));
}
/** Failed rereads cannot erase saved text/fields. Only pending keys may gain evidence. */
export function mergeTargetedReading(previous:any,next:any,target:Target,at=new Date().toISOString()){
 const attempt={signature:target.signature,page:target.page,fields:target.fields,at,outcome:next.problem||next.incomplete?'failed':'completed'};
 const merged={...previous,targetedAttempts:[...(previous.targetedAttempts||[]),attempt]};
 if(next.problem||next.incomplete||!next.text?.trim())return merged;
 merged.fields={...previous.fields};merged.fieldOrigins={...previous.fieldOrigins};
 const accepted:string[]=[];
 for(const key of target.fields){
  const values=[...new Set<string>((next.fields?.[key]||[]).filter((v:string)=>plausibleFieldValue(key,v)))];
  if(values.length!==1)continue;
  const rawExisting=previous.fields?.[key]||[];
  const existing=rawExisting.filter((v:string)=>plausibleFieldValue(key,v));
  // Preserve conflicting observations; a reread is not a correction or human approval.
  if(existing.length&&existing.some((v:string)=>!sameRequestedValue(key,v,values[0])))continue;
  const excerpt=fieldExcerpt(next.text,values);
  if(!excerpt)continue;
  merged.fields[key]=existing.length?existing:values;
  if(rawExisting.length&&!existing.length)merged.targetedInvalidValues={...merged.targetedInvalidValues,[key]:rawExisting};
  merged.fieldOrigins[key]=[...(previous.fieldOrigins?.[key]||[]),{value:values[0],page:target.page,excerpt,method:'Releitura direcionada'}];
  // Only the non-OCR Docling pipeline supplies this flag. Native PDF characters
  // retain their own provenance, independently of matching the GLPI reference.
  if(next.nativeText===true&&next.method==='Docling — estrutura do PDF'&&!(previous.digitalFields?.[key]||[]).some((v:string)=>!sameRequestedValue(key,v,values[0]))){
   merged.digitalFields={...merged.digitalFields,[key]:values};
   merged.digitalFieldOrigins={...merged.digitalFieldOrigins,[key]:[...(previous.digitalFieldOrigins?.[key]||[]),{value:values[0],page:target.page,excerpt,reader:'Docling'}]};
  }
  accepted.push(key);
 }
 if(accepted.length)merged.targetedReadings=[...(previous.targetedReadings||[]),{page:target.page,fields:accepted,text:next.text,method:next.method,confidence:next.confidence}];
 // Original confidence, method, completion and approval flags are intentionally preserved.
 return merged;
}
