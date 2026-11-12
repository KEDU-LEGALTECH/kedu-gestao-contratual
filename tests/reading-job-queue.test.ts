import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {ReadingJobQueue} from '../server/reading-job-queue.js';
test('fila é persistente, exclusiva e retoma trabalho interrompido sem gastar tentativa',async ()=>{
 const db=new DatabaseSync(':memory:');db.exec(readFileSync('migrations/017.sql','utf8'));db.exec(readFileSync('migrations/018.sql','utf8'));
 try{
  let time=100;const q=new ReadingJobQueue(db,()=>time);
  await q.enqueue('a','hash');await q.enqueue('a','hash');await q.enqueue('b','hash');
  const first=(await q.claim())!;assert.equal(first.demand_id,'a');assert.equal(first.attempts,1);assert.equal(await q.claim(),undefined);
  const restarted=new ReadingJobQueue(db,()=>time);const resumed=(await restarted.claim())!;
  assert.equal(resumed.demand_id,'a');assert.equal(resumed.attempts,1);
  await q.finish(first,'done');assert.equal(await restarted.claim(),undefined,'antigo dono não conclui trabalho retomado');
  await restarted.finish(resumed,'retry','temporário');
  const second=(await restarted.claim())!;assert.equal(second.demand_id,'b');await restarted.finish(second,'done');
  assert.equal(await restarted.claim(),undefined);time+=10*60000;
  const retry=(await restarted.claim())!;assert.equal(retry.attempts,2);await restarted.finish(retry,'retry');
  time+=20*60000;const last=(await restarted.claim())!;assert.equal(last.attempts,3);await restarted.finish(last,'retry');
  time+=60*60000;await q.enqueue('a','hash');assert.equal(await restarted.claim(),undefined,'não repete indefinidamente');
  await q.enqueue('a','new-hash');assert.equal((await restarted.claim())?.ticket_hash,'new-hash');
 }finally{db.close();}
});
test('progresso real permite continuar PDF longo, mas repetir o mesmo progresso esgota tentativas',async ()=>{
 const db=new DatabaseSync(':memory:');db.exec(readFileSync('migrations/017.sql','utf8'));db.exec(readFileSync('migrations/018.sql','utf8'));
 try{
  let time=0;const q=new ReadingJobQueue(db,()=>time);await q.enqueue('pdf','hash');
  let job=(await q.claim())!;await q.finish(job,'retry','',4);time+=10*60000;
  job=(await q.claim())!;assert.equal(job.attempts,1);assert.equal(job.progress,4);await q.finish(job,'retry','',8);time+=10*60000;
  for(let i=1;i<=3;i++){job=(await q.claim())!;assert.equal(job.attempts,i);await q.finish(job,'retry','',8);time+=40*60000;}
  assert.equal(await q.claim(),undefined);
 }finally{db.close();}
});

test('trabalho concluído só reabre explicitamente para uma nova releitura direcionada',async ()=>{
 const db=new DatabaseSync(':memory:');db.exec(readFileSync('migrations/017.sql','utf8'));db.exec(readFileSync('migrations/018.sql','utf8'));
 try{
  const q=new ReadingJobQueue(db);await q.enqueue('a','hash');await q.finish((await q.claim())!,'done');
  await q.enqueue('a','hash');assert.equal(await q.claim(),undefined);
  await q.enqueue('a','hash',true);const target=(await q.claim())!;
  assert.equal(target.last_error,'targeted-fields');assert.equal(target.attempts,1);
  await q.finish(target,'done');await q.enqueue('a','hash');assert.equal(await q.claim(),undefined);
 }finally{db.close();}
});
