import {writeFileSync,readFileSync,unlinkSync,mkdirSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
/** Shared by API and local batch tools. No second OCR process starts while held. */
export async function acquireReadingLease() {
 if((process.env.NODE_ENV==='test'||process.env.NODE_TEST_CONTEXT)&&!process.env.READING_LOCK_PATH)return ()=>{};
 // On Vercel only the temporary folder is writable; each instance holds its own reader.
 const path=resolve(process.env.READING_LOCK_PATH||(process.env.VERCEL?join(tmpdir(),'kedu-reading-runtime.lock'):'data/reading-runtime.lock'));mkdirSync(dirname(path),{recursive:true});
 const token=randomUUID(),started=Date.now();
 for(;;){
  try{
   writeFileSync(path,JSON.stringify({pid:process.pid,token}),{flag:'wx'});
   return ()=>{try{if(JSON.parse(readFileSync(path,'utf8')).token===token)unlinkSync(path);}catch{}};
  }catch(error:any){
   if(error.code!=='EEXIST')throw error;
   try{const owner=JSON.parse(readFileSync(path,'utf8'));try{process.kill(owner.pid,0);}catch(e:any){if(e.code==='ESRCH'){if(JSON.parse(readFileSync(path,'utf8')).token===owner.token)unlinkSync(path);continue;}}}catch{/* An owner may still be creating or removing the lease. */}
   if(Date.now()-started>180000)throw Error('Outro leitor está ocupado. A leitura será tentada novamente.');
   await new Promise(r=>setTimeout(r,200));
  }
 }
}
