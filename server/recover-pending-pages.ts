import {mkdirSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {all,run,db,audit} from './db.js';
import {readProcessingFile} from './file-reading.js';
import {captureFieldOrigins} from './identity-evidence.js';
import {distinctRequestedValues} from './request-expectations.js';
import {saveProcessingResult} from './contract-processing.js';
import {createVerifiedBackup} from './backup-service.js';

const apply=process.argv.includes('--apply'),folder='data/pending-page-recovery';mkdirSync(folder,{recursive:true});
const rows=all("SELECT p.demand_id,p.result,t.hash FROM contract_processing p JOIN demands d ON d.id=p.demand_id JOIN glpi_tickets t ON t.external_id=d.glpi_id WHERE p.status='Aguardando análise' AND t.mode='real'");
const backup=apply?await createVerifiedBackup():null;const report:any[]=[];const changed=new Set<string>();
for(const row of rows){
 const result=JSON.parse(row.result);if(!result.issues?.some((i:any)=>/^file:|^review:partial:/.test(i.field)))continue;
 const files=all('SELECT * FROM processing_files WHERE demand_id=? ORDER BY rowid DESC',row.demand_id).filter(f=>f.ticket_hash===row.hash||f.ticket_hash.startsWith(row.hash+':correction:')).filter((f,i,fs)=>fs.findIndex(o=>o.document_id===f.document_id)===i);
 for(const file of files){
  const old=JSON.parse(file.extracted);
  if(!/\.pdf$/i.test(file.name)||!file.bytes?.length||(!old.incomplete&&!file.problem)||!old.pages)continue;
  if(old.assistedVisualEvidence?.length||all('SELECT file_id FROM processing_field_reviews WHERE file_id=? UNION SELECT file_id FROM processing_file_reviews WHERE file_id=?',file.id,file.id).length)continue;
  const page=old.pendingPages?.[0]||(old.pages===1?1:0);if(!page)continue;
  const hash=createHash('sha256').update(Buffer.from(file.bytes)).digest('hex');const path=folder+'/'+hash+'-'+page+'.json';
  let reading:any;
  if(existsSync(path))reading=JSON.parse(readFileSync(path,'utf8')).reading;
  else{
   console.log('Relendo página '+page+' de '+old.pages+': '+file.name);
   reading=await readProcessingFile(Buffer.from(file.bytes),file.name,{page,x:0,y:0,width:1,height:1,rotation:0});
   writeFileSync(path,JSON.stringify({originalHash:hash,page,reading},null,2));
  }
  const usable=!reading.problem&&!reading.incomplete&&reading.text?.trim().length>=60&&(reading.confidence||0)>=60;
  const next={...old};
  if(usable){
   next.text=(old.text||'')+'\n\nRELEITURA LOCAL DA PÁGINA '+page+'\n'+reading.text;
   next.fields={...old.fields};for(const [key,values] of Object.entries(reading.fields)as[string,string[]][])next.fields[key]=distinctRequestedValues(key,[...(next.fields[key]||[]),...values]);
   next.fieldOrigins=structuredClone(old.fieldOrigins||{});captureFieldOrigins(next.fieldOrigins,reading.fields,next.text.slice((old.text||'').length),page);
   next.fieldConfidence={...old.fieldConfidence,...reading.fieldConfidence};
   next.completedPages=[...new Set([...(old.completedPages||[]),page])].sort((a:any,b:any)=>a-b);
   next.pendingPages=(old.pendingPages||[page]).filter((p:number)=>p!==page);
   next.incomplete=next.pendingPages.length>0;next.problem='';next.needsReview=true;
   next.method='PDF com OCR';
   if(old.pages===1){next.confidence=reading.confidence;next.verifiedFields=reading.verifiedFields||[];}
   next.pageRecovery={originalHash:hash,page,readAt:new Date().toISOString()};
   if(apply){
    db.exec('BEGIN IMMEDIATE');try{const current=all('SELECT extracted FROM processing_files WHERE id=?',file.id)[0];
     if(current?.extracted===file.extracted&&!all('SELECT file_id FROM processing_field_reviews WHERE file_id=? UNION SELECT file_id FROM processing_file_reviews WHERE file_id=?',file.id,file.id).length){run('UPDATE processing_files SET extracted=?,problem=? WHERE id=?',JSON.stringify(next),'',file.id);changed.add(row.demand_id);}
     db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
   }
  }
  report.push({demand:row.demand_id,fileId:file.id,name:file.name,page,usable,problem:reading.problem||'',fields:Object.keys(reading.fields||{}),confidence:reading.confidence,pendingAfter:usable?next.pendingPages:old.pendingPages});
  console.log((usable?'Página recuperada: ':'Leitura anterior preservada: ')+file.name);
 }
}
for(const did of changed){saveProcessingResult(did);audit(did,null,'Página pendente relida localmente; originais e leituras anteriores preservados, sem confirmação humana automática.');}
const path=folder+'/'+Date.now()+(apply?'-applied':'-preview')+'.json';writeFileSync(path,JSON.stringify({apply,backup:backup?.path,changedDemands:[...changed],files:report},null,2));console.log(JSON.stringify({apply,attempts:report.length,recovered:report.filter(r=>r.usable).length,report:path}));db.close();
