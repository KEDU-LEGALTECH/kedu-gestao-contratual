import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {ReadingJobQueue} from '../server/reading-job-queue.js';
test('fila é persistente, exclusiva e retoma trabalho interrompido sem gastar tentativa',()=>{
 const db=new DatabaseSync(':memory:');db.exec(readFileSync('migrations/017.sql','utf8'));db.exec(readFileSync('migrations/018.sql','utf8'));
 try{
  let time=100;const q=new ReadingJobQueue(db,()=>time);
  q.enqueue('a','hash');q.enqueue('a','hash');q.enqueue('b','hash');
  const first=q.claim()!;assert.equal(first.demand_id,'a');assert.equal(first.attempts,1);assert.equal(q.claim(),undefined);
  const restarted=new ReadingJobQueue(db,()=>time);const resumed=restarted.claim()!;
  assert.equal(resumed.demand_id,'a');assert.equal(resumed.attempts,1);
  q.finish(first,'done');assert.equal(restarted.claim(),undefined,'antigo dono não conclui trabalho retomado');
  restarted.finish(resumed,'retry','temporário');
  const second=restarted.claim()!;assert.equal(second.demand_id,'b');restarted.finish(second,'done');
  assert.equal(restarted.claim(),undefined);time+=10*60000;
  const retry=restarted.claim()!;assert.equal(retry.attempts,2);restarted.finish(retry,'retry');
  time+=20*60000;const last=restarted.claim()!;assert.equal(last.attempts,3);restarted.finish(last,'retry');
  time+=60*60000;q.enqueue('a','hash');assert.equal(restarted.claim(),undefined,'não repete indefinidamente');
  q.enqueue('a','new-hash');assert.equal(restarted.claim()?.ticket_hash,'new-hash');
 }finally{db.close();}
});
test('progresso real permite continuar PDF longo, mas repetir o mesmo progresso esgota tentativas',()=>{
 const db=new DatabaseSync(':memory:');db.exec(readFileSync('migrations/017.sql','utf8'));db.exec(readFileSync('migrations/018.sql','utf8'));
 try{
  let time=0;const q=new ReadingJobQueue(db,()=>time);q.enqueue('pdf','hash');
  let job=q.claim()!;q.finish(job,'retry','',4);time+=10*60000;
  job=q.claim()!;assert.equal(job.attempts,1);assert.equal(job.progress,4);q.finish(job,'retry','',8);time+=10*60000;
  for(let i=1;i<=3;i++){job=q.claim()!;assert.equal(job.attempts,i);q.finish(job,'retry','',8);time+=40*60000;}
  assert.equal(q.claim(),undefined);
 }finally{db.close();}
});

test('trabalho concluído só reabre explicitamente para uma nova releitura direcionada',()=>{
 const db=new DatabaseSync(':memory:');db.exec(readFileSync('migrations/017.sql','utf8'));db.exec(readFileSync('migrations/018.sql','utf8'));
 try{
  const q=new ReadingJobQueue(db);q.enqueue('a','hash');q.finish(q.claim()!,'done');
  q.enqueue('a','hash');assert.equal(q.claim(),undefined);
  q.enqueue('a','hash',true);const target=q.claim()!;
  assert.equal(target.last_error,'targeted-fields');assert.equal(target.attempts,1);
  q.finish(target,'done');q.enqueue('a','hash');assert.equal(q.claim(),undefined);
 }finally{db.close();}
});
