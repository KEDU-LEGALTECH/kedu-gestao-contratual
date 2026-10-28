import 'dotenv/config';
import {DatabaseSync} from 'node:sqlite';
import {processingStatus} from './processing-status.js';
import {createVerifiedBackup} from './backup-service.js';

// Reclassify saved comparisons only; never download, run OCR or change originals.
const apply=process.argv.includes('--apply');
const source=process.env.DATABASE_PATH||'data/kedu.sqlite';
if(apply){
 console.log('Backup verificado:',(await createVerifiedBackup(source)).path);
 // Install the status schema before updating legacy databases.
 await import('./db.js');
}
const db=new DatabaseSync(source,{readOnly:!apply});
try {
 db.exec('PRAGMA busy_timeout=5000');
 const rows=db.prepare(`SELECT p.*,d.glpi_id,d.stage,s.name FROM contract_processing p
 JOIN demands d ON d.id=p.demand_id LEFT JOIN schools s ON s.id=d.school_id
 WHERE p.status<>'Analisando' AND d.stage NOT IN('Concluído','Cancelado','Em assinatura')`).all() as any[];
 const changes=rows.flatMap(row=>{
  const result=JSON.parse(row.result),next=processingStatus(result.issues||[],result.comparisons||[]);
  return row.status===next?[]:[{...row,next}];
 });
 console.log(JSON.stringify({examined:rows.length,changes:changes.map(r=>({id:r.demand_id,glpi:r.glpi_id,name:r.name,from:r.status,to:r.next}))},null,2));
 if(apply){
  db.exec('BEGIN IMMEDIATE');
  try {
   let updated=0;
   for(const row of changes)updated+=Number(db.prepare(`UPDATE contract_processing SET status=?,updated=?
    WHERE demand_id=? AND status=? AND revision=? AND result=?`).run(row.next,new Date().toISOString(),row.demand_id,row.status,row.revision,row.result).changes);
   db.exec('COMMIT');console.log('Etapas corrigidas:',updated);
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
}finally{db.close();}
