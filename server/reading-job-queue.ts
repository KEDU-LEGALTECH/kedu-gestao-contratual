import type {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';

/** Durable demand queue. The backend instance lease guarantees one API owner per database. */
export class ReadingJobQueue {
 private owner=randomUUID();
 constructor(private db:DatabaseSync,private time=()=>Date.now()) {
  // An interrupted attempt resumes with its saved page cache instead of consuming a retry.
  db.prepare("UPDATE reading_jobs SET state='queued',attempts=max(0,attempts-1),owner=NULL,available_at=?,updated=?,last_error=CASE WHEN last_error='targeted-fields' THEN last_error ELSE 'Processamento interrompido; retomada pendente' END WHERE state='running'").run(time(),time());
 }
 /** reopenFailed: a file still needs recovery. A job marked done reopens now; an exhausted one once a day. */
 enqueue(demand:string,hash:string,reopenCompleted=false,reopenFailed=false) {
  const at=this.time();
  this.db.prepare("UPDATE reading_jobs SET state='superseded',updated=? WHERE demand_id=? AND ticket_hash<>? AND state IN('queued','retry')").run(at,demand,hash);
  this.db.prepare("INSERT OR IGNORE INTO reading_jobs(demand_id,ticket_hash,state,available_at,updated) VALUES(?,?,'queued',?,?)").run(demand,hash,at,at);
  if(reopenCompleted)this.db.prepare("UPDATE reading_jobs SET state='queued',attempts=0,available_at=?,updated=?,last_error='targeted-fields' WHERE demand_id=? AND ticket_hash=? AND state IN('done','exhausted')").run(at,at,demand,hash);
  if(reopenFailed)this.db.prepare("UPDATE reading_jobs SET state='queued',attempts=0,available_at=?,updated=?,last_error='' WHERE demand_id=? AND ticket_hash=? AND (state='done' OR (state='exhausted' AND updated<=?))").run(at,at,demand,hash,at-24*3600000);
 }
 claim() {
  const at=this.time();
  return this.db.prepare(`UPDATE reading_jobs SET state='running',owner=?,attempts=attempts+1,updated=?
   WHERE (demand_id,ticket_hash)=(SELECT demand_id,ticket_hash FROM reading_jobs
   WHERE state IN('queued','retry') AND available_at<=? ORDER BY available_at,demand_id LIMIT 1)
   AND state IN('queued','retry') AND NOT EXISTS(SELECT 1 FROM reading_jobs WHERE state='running') RETURNING *`).get(this.owner,at,at) as {demand_id:string;ticket_hash:string;attempts:number;progress:number;last_error?:string}|undefined;
 }
 finish(job:{demand_id:string;ticket_hash:string;attempts:number;progress?:number;last_error?:string},outcome:'done'|'retry'|'superseded',reason='',progress?:number) {
  if(outcome==='retry'&&job.last_error==='targeted-fields')reason='targeted-fields';
  const advanced=progress!==undefined&&progress>(job.progress||0),attempts=advanced?0:job.attempts;
  const state=outcome==='retry'&&attempts>=3?'exhausted':outcome;
  const at=this.time(),due=at+10*60000*2**Math.max(0,attempts-1);
  this.db.prepare("UPDATE reading_jobs SET state=?,attempts=?,progress=max(progress,?),available_at=?,owner=NULL,updated=?,last_error=? WHERE demand_id=? AND ticket_hash=? AND owner=? AND state='running'").run(state,attempts,progress||0,due,at,reason.slice(0,1000),job.demand_id,job.ticket_hash,this.owner);
 }
}
