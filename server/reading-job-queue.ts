import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {sqliteSql,type Sql} from './sql.js';

type Job={demand_id:string;ticket_hash:string;attempts:number;progress:number;last_error?:string};

/** Durable demand queue. The backend instance lease guarantees one API owner per database;
 * on PostgreSQL an advisory lock also serializes claims between processes. */
export class ReadingJobQueue {
 private owner=randomUUID();
 private sql:Sql;
 private ready:Promise<unknown>;
 constructor(db:DatabaseSync|Sql,private time=()=>Date.now()) {
  this.sql=db instanceof DatabaseSync?sqliteSql(db):db;
  // An interrupted attempt resumes with its saved page cache instead of consuming a retry.
  this.ready=this.sql.run("UPDATE reading_jobs SET state='queued',attempts=max(0,attempts-1),owner=NULL,available_at=?,updated=?,last_error=CASE WHEN last_error='targeted-fields' THEN last_error ELSE 'Processamento interrompido; retomada pendente' END WHERE state='running'",time(),time());
 }
 private async serialized<T>(work:()=>Promise<T>){
  await this.ready;
  return this.sql.transaction(async()=>{
   if(this.sql.dialect==='postgres')await this.sql.one("SELECT pg_advisory_xact_lock(hashtext(current_schema() || '.kedu_reading_queue')::bigint)");
   return work();
  });
 }
 /** reopenFailed: a file still needs recovery. A job marked done reopens now; an exhausted one once a day. */
 enqueue(demand:string,hash:string,reopenCompleted=false,reopenFailed=false) {
  const at=this.time();
  return this.serialized(async()=>{
   await this.sql.run("UPDATE reading_jobs SET state='superseded',updated=? WHERE demand_id=? AND ticket_hash<>? AND state IN('queued','retry')",at,demand,hash);
   await this.sql.run("INSERT OR IGNORE INTO reading_jobs(demand_id,ticket_hash,state,available_at,updated) VALUES(?,?,'queued',?,?)",demand,hash,at,at);
   if(reopenCompleted)await this.sql.run("UPDATE reading_jobs SET state='queued',attempts=0,available_at=?,updated=?,last_error='targeted-fields' WHERE demand_id=? AND ticket_hash=? AND state IN('done','exhausted')",at,at,demand,hash);
   if(reopenFailed)await this.sql.run("UPDATE reading_jobs SET state='queued',attempts=0,available_at=?,updated=?,last_error='' WHERE demand_id=? AND ticket_hash=? AND (state='done' OR (state='exhausted' AND updated<=?))",at,at,demand,hash,at-24*3600000);
  });
 }
 async settleIdle(demand:string,hash:string){
  await this.ready;
  await this.sql.run("UPDATE reading_jobs SET state='done',owner=NULL,updated=?,last_error='' WHERE demand_id=? AND ticket_hash=? AND state IN('queued','retry')",this.time(),demand,hash);
 }
 claim():Promise<Job|undefined> {
  const at=this.time();
  return this.serialized(()=>this.sql.one(`UPDATE reading_jobs SET state='running',owner=?,attempts=attempts+1,updated=?
   WHERE (demand_id,ticket_hash)=(SELECT demand_id,ticket_hash FROM reading_jobs
   WHERE state IN('queued','retry') AND available_at<=? ORDER BY available_at,demand_id LIMIT 1)
   AND state IN('queued','retry') AND NOT EXISTS(SELECT 1 FROM reading_jobs WHERE state='running') RETURNING *`,this.owner,at,at));
 }
 /** temporary: the machine, not the file, prevented the reading (low memory, reader unavailable).
  * Such an attempt is retried later without counting towards exhaustion. */
 async finish(job:{demand_id:string;ticket_hash:string;attempts:number;progress?:number;last_error?:string},outcome:'done'|'retry'|'superseded',reason='',progress?:number,temporary=false) {
  await this.ready;
  if(outcome==='retry'&&job.last_error==='targeted-fields')reason='targeted-fields';
  const advanced=progress!==undefined&&progress>(job.progress||0),attempts=advanced?0:temporary&&outcome==='retry'?Math.max(0,job.attempts-1):job.attempts;
  const state=outcome==='retry'&&attempts>=3?'exhausted':outcome;
  const at=this.time(),due=at+10*60000*2**Math.max(0,attempts-1);
  await this.sql.run("UPDATE reading_jobs SET state=?,attempts=?,progress=max(progress,?),available_at=?,owner=NULL,updated=?,last_error=? WHERE demand_id=? AND ticket_hash=? AND owner=? AND state='running'",state,attempts,progress||0,due,at,reason.slice(0,1000),job.demand_id,job.ticket_hash,this.owner);
 }
}
