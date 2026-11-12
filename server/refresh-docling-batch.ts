import 'dotenv/config';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
const folder=resolve(process.argv[2]),mode=process.argv[3]||'live';
const report=JSON.parse(readFileSync(join(folder,'report.json'),'utf8'));
const before=JSON.parse(readFileSync(join(folder,'before.json'),'utf8'));
process.env.NODE_ENV='test';process.env.DEMO_SEED='false';
if(mode==='snapshot')process.env.DATABASE_PATH=join(folder,'snapshot.sqlite');
const {db,one,run}=await import('./db.js');
const {saveProcessingResult}=await import('./contract-processing.js');
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
try{
 if(mode==='snapshot'&&report.notApplied.length){
  const metadata=readFileSync('data/docling-batch-console.log','utf8').split(/\r?\n/).filter(l=>l.startsWith('{')).map(l=>{try{return JSON.parse(l);}catch{return {};}}).find(v=>v.folder===folder&&v.backup);
  if(!metadata)throw Error('Backup de origem não localizado.');
  const backup=new DatabaseSync(metadata.backup,{readOnly:true});
  try{for(const skipped of report.notApplied){
   const previous=backup.prepare('SELECT extracted FROM processing_files WHERE id=?').get(skipped.id) as any;
   const current=one('SELECT extracted FROM processing_files WHERE id=?',skipped.id);
   if(previous&&current){run('UPDATE processing_files SET extracted=? WHERE id=?',previous.extracted,skipped.id);run('UPDATE processing_field_reviews SET extraction_hash=? WHERE file_id=? AND extraction_hash=?',sha(previous.extracted),skipped.id,sha(current.extracted));}
  }}finally{backup.close();}
 }
 const ids=mode==='snapshot'?before.map((r:any)=>r.id):[...new Set(report.applied.map((r:any)=>r.demand))];
 const refreshed:any[]=[];let skipped=0;
 for(const id of ids){
  if(mode!=='snapshot'&&one('SELECT status FROM contract_processing WHERE demand_id=?',id)?.status==='Analisando'){skipped++;continue;}
  db.exec('BEGIN IMMEDIATE');try{const result=await saveProcessingResult(id);if(result)refreshed.push({id,glpi:before.find((r:any)=>r.id===id)?.glpi,status:result.status,comparisons:result.comparisons});db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
 }
 if(mode==='snapshot'){
  const count=(items:any[],field:string)=>items.reduce((a,r)=>(a[r[field]]=(a[r[field]]||0)+1,a),{});
  report.after={stages:count(refreshed,'status'),fields:count(refreshed.flatMap(r=>r.comparisons),'status')};
  report.changes=refreshed.flatMap(next=>next.comparisons.flatMap((c:any)=>{const old=before.find((r:any)=>r.id===next.id)?.comparisons.find((r:any)=>r.field===c.field);return old&&(old.status!==c.status||old.found!==c.found)?[{demand:next.id,glpi:next.glpi,field:c.field,from:old.status,to:c.status,previous:old.found,found:c.found}]:[];}));
  report.transitions=refreshed.filter(r=>before.find((b:any)=>b.id===r.id).status!==r.status).map(r=>({demand:r.id,glpi:r.glpi,from:before.find((b:any)=>b.id===r.id).status,to:r.status}));
  report.measurement='Mesma cópia do banco; somente leituras efetivamente aplicadas à base';
  writeFileSync(join(folder,'report.json'),JSON.stringify(report,null,2));writeFileSync(join(folder,'after.json'),JSON.stringify(refreshed));
 }
 console.log(JSON.stringify({mode,refreshed:refreshed.length,skipped}));
}finally{db.close();}
process.exit(0);
