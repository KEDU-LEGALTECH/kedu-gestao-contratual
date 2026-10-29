import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {acquireReadingLease} from '../server/reading-runtime-lock.js';
test('shared lease permits only one active reader and releases ownership safely',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'kedu-reader-lock-')),path=join(folder,'reader.lock');
 process.env.READING_LOCK_PATH=path;let releaseA:(()=>void)|undefined,releaseB:(()=>void)|undefined;
 try {
  releaseA=await acquireReadingLease();let acquired=false;
  const pending=acquireReadingLease().then(release=>{acquired=true;return release;});
  await new Promise(r=>setTimeout(r,20));assert.equal(acquired,false);
  releaseA();releaseB=await pending;assert.equal(acquired,true);
  releaseA();assert.equal(JSON.parse(readFileSync(path,'utf8')).pid,process.pid);
 }finally{releaseA?.();releaseB?.();delete process.env.READING_LOCK_PATH;rmdirSync(folder);}
});
