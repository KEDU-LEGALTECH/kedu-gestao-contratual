import { all, db, sql } from './db.js';
import {recoveryReason} from './contract-processing.js';

// Explains reading jobs that gave up. Without --apply it only prints; with --apply it fills
// the empty last_error of exhausted jobs. No OCR, downloads or result changes.
const apply=process.argv.includes('--apply');
const jobs=await sql.all("SELECT j.demand_id,j.ticket_hash,j.state,j.attempts,j.last_error,d.glpi_id FROM reading_jobs j JOIN demands d ON d.id=j.demand_id WHERE j.state IN('exhausted','retry','queued') ORDER BY j.state,d.glpi_id");
const causes:Record<string,number>={};
for(const job of jobs){
 const reason=job.last_error||await recoveryReason(job.demand_id,job.ticket_hash,true);
 for(const part of reason.split(' | ')){const cause=part.replace(/^[^:]*: /,'').replace(/ — .*$/,'').replace(/\(\d+\/[\d?]+ páginas\)/,'(páginas)');causes[cause]=(causes[cause]||0)+1;}
 console.log(`${job.glpi_id} [${job.state}, ${job.attempts} tentativas] ${reason}`);
 if(apply&&job.state==='exhausted'&&!job.last_error)db.prepare("UPDATE reading_jobs SET last_error=? WHERE demand_id=? AND ticket_hash=? AND state='exhausted' AND last_error=''").run(('Diagnóstico posterior: '+reason).slice(0,1000),job.demand_id,job.ticket_hash);
}
console.log('\nAnexos por causa:',causes);
db.close();
