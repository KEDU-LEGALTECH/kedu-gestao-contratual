import {mkdirSync,writeFileSync} from 'node:fs';
import { all, db, audit, sql, auditAsync } from './db.js';
import {buildProcessingPlan,saveProcessingResult} from './contract-processing.js';
import {processingStatus} from './processing-status.js';
import {createVerifiedBackup} from './backup-service.js';

// No OCR, downloads, file updates or synthetic human confirmations.
const apply=process.argv.includes('--apply');
const rows=await sql.all("SELECT p.*,d.glpi_id FROM contract_processing p JOIN demands d ON d.id=p.demand_id JOIN glpi_tickets t ON t.external_id=d.glpi_id WHERE t.mode='real' AND d.stage NOT IN ('Concluído','Cancelado','Em assinatura') ORDER BY p.demand_id");
const backup=apply?await createVerifiedBackup():null;
const statesBefore:Record<string,number>={},statesAfter:Record<string,number>={};
const changes:any[]=[];
if(apply)db.exec('BEGIN IMMEDIATE');
try{
 for(const row of rows){
  const before=JSON.parse(row.result||'{}');const plan=await buildProcessingPlan(row.demand_id);if(!plan)continue;
  const status=processingStatus(plan.issues,plan.comparisons);
  statesBefore[row.status]=(statesBefore[row.status]||0)+1;statesAfter[status]=(statesAfter[status]||0)+1;
  const fields=plan.comparisons.flatMap((after:any)=>{
   const old=before.comparisons?.find((c:any)=>c.field===after.field);
   return old&&(old.status!==after.status||old.found!==after.found)?[{field:after.field,before:{status:old.status,found:old.found},after:{status:after.status,found:after.found},source:after.source}]:[];
  });
  if(row.status!==status||fields.length)changes.push({demand:row.demand_id,glpi:row.glpi_id,before:row.status,after:status,fields});
  if(apply){await saveProcessingResult(row.demand_id);if(fields.length||row.status!==status)await auditAsync(row.demand_id, null, 'Comparação local refeita a partir dos textos já extraídos; sem OCR, sem alterar originais ou confirmações humanas.');}
 }
 if(apply)db.exec('COMMIT');
}catch(error){if(apply)db.exec('ROLLBACK');throw error;}
mkdirSync('data/text-recovery-measurements',{recursive:true});
const path='data/text-recovery-measurements/'+Date.now()+(apply?'-applied':'-preview')+'.json';
const report={apply,backup:backup?.path,demands:rows.length,statesBefore,statesAfter,changes};
writeFileSync(path,JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,changes:changes.map(c=>({...c,fields:c.fields.map((f:any)=>({field:f.field,before:f.before.status,after:f.after.status}))})),report:path},null,2));
db.close();
