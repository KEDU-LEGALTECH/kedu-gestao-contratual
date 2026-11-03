import 'dotenv/config';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {readDoclingPage} from './docling-reader.js';
import {mergeTargetedReading} from './targeted-reading.js';
const folder=resolve(process.argv[2]);
const report=JSON.parse(readFileSync(join(folder,'report.json'),'utf8'));
const attempts=JSON.parse(readFileSync(join(folder,'attempts.json'),'utf8'));
const failed=attempts.filter((a:any)=>a.error),sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const live=new DatabaseSync(process.env.DATABASE_PATH||'data/kedu.sqlite');live.exec('PRAGMA busy_timeout=10000');
const previous=(live.prepare('SELECT value FROM settings WHERE key=?').get('documentReadingPaused') as any)?.value,owner=randomUUID();
process.env.NODE_ENV='test';process.env.READING_LOCK_PATH=resolve('data/reading-runtime.lock');
const snapshot=new DatabaseSync(join(folder,'snapshot.sqlite'));const retries:any[]=[];
try{
 live.prepare('INSERT OR REPLACE INTO settings VALUES(?,?)').run('doclingBatchPauseOwner',owner);
 live.prepare('INSERT OR REPLACE INTO settings VALUES(?,?)').run('documentReadingPaused','true');
 for(const attempt of failed){
  const selection=new Set(JSON.parse(readFileSync(join(folder,'selection.json'),'utf8')).map((f:any)=>f.id));
  const files=(snapshot.prepare('SELECT * FROM processing_files WHERE demand_id=? AND name=?').all(attempt.demand,attempt.file) as any[]).filter(f=>selection.has(f.id));
  if(files.length!==1){retries.push({...attempt,ok:false,reason:'Mais de um anexo com esse nome; origem exige conferência'});continue;}
  const file=files[0];
  const result=await readDoclingPage(Buffer.from(file.bytes),attempt.page,{pilot:true,timeoutMs:120000});
  retries.push({...attempt,error:result.ok?undefined:result.reason,ok:result.ok,reason:result.reason,seconds:result.seconds,readSeconds:result.readSeconds,peakMemoryMB:result.peakMemoryMB});
  console.log(JSON.stringify(retries.at(-1)));
  if(!result.ok)continue;
  const next=JSON.stringify(mergeTargetedReading(JSON.parse(file.extracted),{...result,problem:''},{page:attempt.page,fields:attempt.fields,signature:sha(JSON.stringify(['docling-retry-v1',attempt.file,attempt.page,attempt.fields]))}));
  live.exec('BEGIN IMMEDIATE');try{
   const current=live.prepare('SELECT extracted,ticket_hash FROM processing_files WHERE id=?').get(file.id) as any;
   const ticket=live.prepare('SELECT hash FROM glpi_tickets WHERE external_id=(SELECT glpi_id FROM demands WHERE id=?)').get(attempt.demand) as any;
   const whole=live.prepare('SELECT file_id FROM processing_file_reviews WHERE file_id=? AND extraction_hash=?').get(file.id,sha(file.extracted));
   const reviews=live.prepare('SELECT field FROM processing_field_reviews WHERE file_id=? AND extraction_hash=?').all(file.id,sha(file.extracted)) as any[];
   if(!current||current.extracted!==file.extracted||ticket?.hash!==file.ticket_hash||whole||reviews.some(r=>attempt.fields.includes(r.field))){
    retries.at(-1).notApplied='Leitura ou confirmação mudou durante o processamento';live.exec('COMMIT');continue;
   }
   live.prepare('UPDATE processing_files SET extracted=? WHERE id=?').run(next,file.id);
   live.prepare('UPDATE processing_field_reviews SET extraction_hash=? WHERE file_id=? AND extraction_hash=?').run(sha(next),file.id,sha(file.extracted));
   live.prepare("UPDATE contract_processing SET revision=revision+1,result=json_set(result,'$.fingerprint',?) WHERE demand_id=?").run('docling-retry-'+owner,attempt.demand);
   live.exec('COMMIT');
  }catch(e){live.exec('ROLLBACK');throw e;}
  snapshot.prepare('UPDATE processing_files SET extracted=? WHERE id=?').run(next,file.id);
  snapshot.prepare('UPDATE processing_field_reviews SET extraction_hash=? WHERE file_id=? AND extraction_hash=?').run(sha(next),file.id,sha(file.extracted));
  report.notApplied=report.notApplied.filter((f:any)=>f.id!==file.id);
  if(!report.applied.some((f:any)=>f.id===file.id))report.applied.push({id:file.id,demand:attempt.demand});
 }
 report.retries=retries;report.failedPagesAfterRetry=failed.filter((a:any)=>!retries.some(r=>r.demand===a.demand&&r.file===a.file&&r.page===a.page&&r.ok&&!r.notApplied)).length;
 writeFileSync(join(folder,'retries.json'),JSON.stringify(retries,null,2));writeFileSync(join(folder,'report.json'),JSON.stringify(report,null,2));
}finally{
 snapshot.close();
 if((live.prepare('SELECT value FROM settings WHERE key=?').get('doclingBatchPauseOwner') as any)?.value===owner){
  if(previous===undefined)live.prepare('DELETE FROM settings WHERE key=?').run('documentReadingPaused');else live.prepare('INSERT OR REPLACE INTO settings VALUES(?,?)').run('documentReadingPaused',previous);
  live.prepare('DELETE FROM settings WHERE key=?').run('doclingBatchPauseOwner');
 }
 live.close();
}
process.exit(0);
