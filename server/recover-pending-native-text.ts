import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import { all, db, run, audit, sql, auditAsync } from './db.js';
import {recoverDigitalOriginal} from './digital-recovery.js';
import {distinctRequestedValues} from './request-expectations.js';
import {buildProcessingPlan,saveProcessingResult} from './contract-processing.js';
import {processingStatus} from './processing-status.js';
import {createVerifiedBackup} from './backup-service.js';

const apply=process.argv.includes('--apply');
const folder='data/pending-native-recovery';mkdirSync(folder,{recursive:true});
const rows=await sql.all("SELECT p.demand_id,p.result,t.hash FROM contract_processing p JOIN demands d ON d.id=p.demand_id JOIN glpi_tickets t ON t.external_id=d.glpi_id WHERE p.status='Aguardando análise' AND t.mode='real'");
const report:any[]=[];const changed=new Set<string>();
const previewUpdates:{id:string;demand:string;before:string;after:string}[]=[];
const backup=apply?await createVerifiedBackup():null;
for(const row of rows){
 const result=JSON.parse(row.result);if(!result.comparisons?.some((c:any)=>c.status==='review'||c.status==='missing'&&c.missingReason==='not_located')&&!result.issues?.some((i:any)=>/^file:|^review:partial:/.test(i.field)))continue;
 const files=(await sql.all('SELECT * FROM processing_files WHERE demand_id=? ORDER BY rowid DESC', row.demand_id)).filter(f=>f.ticket_hash===row.hash||f.ticket_hash.startsWith(row.hash+':correction:')).filter((f,i,fs)=>fs.findIndex(o=>o.document_id===f.document_id)===i);
 for(const file of files){
  if(!/\.(pdf|docx|xlsx)$/i.test(file.name)||!file.bytes?.length)continue;
  if((await sql.all('SELECT file_id FROM processing_field_reviews WHERE file_id=? UNION SELECT file_id FROM processing_file_reviews WHERE file_id=?', file.id, file.id)).length){report.push({fileId:file.id,name:file.name,skipped:'human-review-preserved'});continue;}
  const originalHash=createHash('sha256').update(Buffer.from(file.bytes)).digest('hex');
  const cachePath=folder+'/'+file.id+'.json';
  try{
   let native:any;
   const cache=existsSync(cachePath)?JSON.parse(readFileSync(cachePath,'utf8')):null;
   if(cache?.version===2&&cache.originalHash===originalHash)native=cache.reading;
   else{native=await recoverDigitalOriginal(Buffer.from(file.bytes),file.name);writeFileSync(cachePath,JSON.stringify({version:2,originalHash,reading:native},null,2));}
   const old=JSON.parse(file.extracted);const digitalFields={...old.digitalFields};
   for(const [key,values] of Object.entries(native.fields) as [string,string[]][])digitalFields[key]=distinctRequestedValues(key,[...(digitalFields[key]||[]),...values]);
   const additions=Object.fromEntries(Object.entries(native.fields).filter(([key,values]:any)=>!old.fields?.[key]?.length&&values.length));
   const next={...old,fields:{...old.fields,...additions},digitalFields,digitalFieldOrigins:native.fieldOrigins,...(native.literalIdentityFields?{literalIdentityFields:native.literalIdentityFields,literalIdentityOrigins:native.literalIdentityOrigins}:{}),nativeRecovery:{version:1,originalHash,pages:native.pages,pendingPages:native.pendingPages}};
   // No scan/image or uninspected DOCX content is declared complete here.
   if(/\.pdf$/i.test(file.name)&&native.pendingPages.length===0&&native.text.trim().length>=80){next.incomplete=false;next.completedPages=Array.from({length:native.pages},(_,i)=>i+1);next.pendingPages=[];}
   const modified=JSON.stringify(next)!==file.extracted;
   if(modified)previewUpdates.push({id:file.id,demand:row.demand_id,before:file.extracted,after:JSON.stringify(next)});
   if(apply&&modified){
    // A stale snapshot must never overwrite a concurrent re-read or human review.
    db.exec('BEGIN IMMEDIATE');
    try{
     const current=(await sql.all('SELECT extracted FROM processing_files WHERE id=?', file.id))[0];
     const reviews=await sql.all('SELECT file_id FROM processing_field_reviews WHERE file_id=? UNION SELECT file_id FROM processing_file_reviews WHERE file_id=?', file.id, file.id);
     if(current?.extracted===file.extracted&&!reviews.length){await sql.run('UPDATE processing_files SET extracted=? WHERE id=?', JSON.stringify(next), file.id);changed.add(row.demand_id);}
     db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
   }
   report.push({demand:row.demand_id,fileId:file.id,name:file.name,newFields:Object.keys(additions),digitalFields:Object.keys(native.fields),pendingPages:native.pendingPages,modified});
   console.log('Texto nativo: '+file.name+' — '+Object.keys(native.fields).length+' campos');
  }catch(e:any){report.push({demand:row.demand_id,fileId:file.id,name:file.name,error:e.message});console.log('Preservado após falha: '+file.name);}
 }
}
const comparisonChanges:any[]=[];
if(!apply)db.exec('BEGIN IMMEDIATE');
try{
 if(!apply)for(const update of previewUpdates){await sql.run('UPDATE processing_files SET extracted=? WHERE id=? AND extracted=?', update.after, update.id, update.before);changed.add(update.demand);}
 for(const did of changed){
  const old=rows.find(r=>r.demand_id===did);const before=JSON.parse(old.result);const plan=await buildProcessingPlan(did);if(!plan)continue;
  const status=processingStatus(plan.issues,plan.comparisons);
  const fields=plan.comparisons.flatMap((c:any)=>{const b=before.comparisons?.find((b:any)=>b.field===c.field);return b&&(b.status!==c.status||b.found!==c.found)?[{field:c.field,before:b.status,after:c.status,found:c.found,expected:c.expected}]:[];});
  comparisonChanges.push({demand:did,before:'Aguardando análise',after:status,fields});
 }
}finally{if(!apply)db.exec('ROLLBACK');}
if(apply){db.exec('BEGIN IMMEDIATE');try{for(const did of changed){await saveProcessingResult(did);await auditAsync(did, null, 'Camada de texto dos originais locais recuperada com página/trecho; sem OCR, sem consulta externa ou confirmação humana.');}db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}
const path=folder+'/'+Date.now()+(apply?'-applied':'-preview')+'.json';
writeFileSync(path,JSON.stringify({apply,backup:backup?.path,changedDemands:[...changed],comparisonChanges,files:report},null,2));
console.log(JSON.stringify({apply,files:report.length,changedDemands:changed.size,comparisonChanges:comparisonChanges.filter(c=>c.fields.length||c.after!==c.before),report:path},null,2));db.close();
