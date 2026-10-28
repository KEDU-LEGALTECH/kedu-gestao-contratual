import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,existsSync,mkdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {resolve,join} from 'node:path';
export function codeSignature(root=process.cwd()) {
 const hash=createHash('sha256');
 for(const folder of ['server','shared'])for(const file of (readdirSync(join(root,folder),{recursive:true}) as string[]).filter(f=>/\.(ts|py)$/.test(f)).sort())hash.update(folder+'/'+file+'\0').update(readFileSync(join(root,folder,file)));
 return hash.digest('hex').slice(0,16);
}
export const backendVersion={build:codeSignature(),started:new Date().toISOString(),pid:process.pid};
/** One running API per database; ownership is checked before releasing the lease. */
export function acquireBackendInstance(database=process.env.DATABASE_PATH||'data/kedu.sqlite') {
 const root=resolve('data');mkdirSync(root,{recursive:true});
 const key=createHash('sha256').update(resolve(database).toLowerCase()).digest('hex').slice(0,16);
 const path=join(root,`backend-instance-${key}.json`);
 if(existsSync(path)){
  let previous:any;try{previous=JSON.parse(readFileSync(path,'utf8'));}catch{throw Error('Registro da instância inválido. Confira data/backend-instance antes de iniciar outra API.');}
  let alive=false;try{process.kill(previous.pid,0);alive=true;}catch(error:any){if(error.code!=='ESRCH')alive=true;}
  if(alive&&previous.pid!==process.pid)throw Error('Já existe uma API ativa para este banco. Reinicie a instância existente antes de iniciar outra.');
  if(alive&&previous.pid===process.pid)return;
  unlinkSync(path);
 }
 writeFileSync(path,JSON.stringify({...backendVersion,database:resolve(database)},null,2),{flag:'wx'});
 const release=()=>{try{if(JSON.parse(readFileSync(path,'utf8')).pid===process.pid)unlinkSync(path);}catch{}};
 process.once('exit',release);
 for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{release();process.exit(0);});
}
