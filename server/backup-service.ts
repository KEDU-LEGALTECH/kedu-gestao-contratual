import {DatabaseSync,backup} from "node:sqlite";
import {mkdir,rename,writeFile,readdir,rm,stat} from "node:fs/promises";
import {resolve,join} from "node:path";
import {randomUUID} from "node:crypto";
export function backupInterval(env:NodeJS.ProcessEnv=process.env) {
 const hours=Number(env.BACKUP_INTERVAL_HOURS||0);
 if(!Number.isFinite(hours)||hours<0||hours>168 || (hours>0 && hours<1))throw Error("BACKUP_INTERVAL_HOURS deve ser 0 (desativado) ou entre 1 e 168.");
 return hours*3600000;
}
export async function createVerifiedBackup(source=process.env.DATABASE_PATH||"data/kedu.sqlite",folder=process.env.BACKUP_DIR||"data/backups") {
 const directory=resolve(folder);await mkdir(directory,{recursive:true});
 const target=join(directory,"kedu-"+new Date().toISOString().replace(/[:.]/g,"-")+"-"+randomUUID().slice(0,8)+".sqlite"),partial=target+".partial";
 let demands=0;
 try{
  const live=new DatabaseSync(resolve(source),{readOnly:true});
  try{await backup(live,partial);}finally{live.close();}
  const restored=new DatabaseSync(partial,{readOnly:true});
  try {
   const integrity=restored.prepare("PRAGMA integrity_check").all() as any[];
   if(integrity.length!==1 || integrity[0].integrity_check!=="ok" || restored.prepare("PRAGMA foreign_key_check").all().length)throw Error("Backup inválido: integridade ou referências inconsistentes.");
   demands=Number((restored.prepare("SELECT COUNT(*) n FROM demands").get() as any).n);
  }finally{restored.close();}
  await rename(partial,target);
 }catch(error){
  // A failed copy is never a restore point; its leftovers only fill the disk.
  await Promise.all(["",
   "-wal","-shm","-journal"].map(suffix=>rm(partial+suffix,{force:true})));
  throw error;
 }
 const result={path:target,created:new Date().toISOString(),demands,integrity:"ok"};
 await writeFile(join(directory,"last-success.json"),JSON.stringify(result,null,2),{mode:0o600});
 return result;
}
/** How many automatic backups to keep. 0 (default) keeps all, as before. */
export function backupKeep(env:NodeJS.ProcessEnv=process.env) {
 const keep=Number(env.BACKUP_KEEP||0);
 if(!Number.isInteger(keep)||keep<0||(keep>0&&keep<2))throw Error("BACKUP_KEEP deve ser 0 (manter todos) ou pelo menos 2.");
 return keep;
}
const automatic=/^kedu-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f]{8}\.sqlite$/;
/** Removes the oldest verified automatic backups beyond `keep`, with their sidecar files, and
 * leftovers of failed copies older than a day. Manually named backups are never touched. */
export async function pruneBackups(keep:number,folder=process.env.BACKUP_DIR||"data/backups",now=Date.now()) {
 if(!keep)return [];
 const directory=resolve(folder),names=await readdir(directory);
 const backups=names.filter(name=>automatic.test(name)).sort();
 const removed:string[]=[];
 for(const name of backups.slice(0,Math.max(0,backups.length-keep)))
  for(const file of names.filter(other=>other===name||other.startsWith(name+"-")||other.startsWith(name+".partial"))){await rm(join(directory,file),{force:true});removed.push(file);}
 for(const name of names.filter(n=>/^kedu-.+\.sqlite\.partial(?:-wal|-shm|-journal)?$/.test(n)&&!removed.includes(n)))
  if(now-(await stat(join(directory,name))).mtimeMs>86400000){await rm(join(directory,name),{force:true});removed.push(name);}
 return removed;
}
export function startBackups(env:NodeJS.ProcessEnv=process.env,execute=()=>createVerifiedBackup()) {
 const interval=backupInterval(env);if(!interval || env.NODE_ENV==="test")return ()=>{};
 const keep=backupKeep(env);
 let running=false,stopped=false;
 const tick=async()=>{if(running || stopped)return;running=true;try{await execute();console.info("Backup automático concluído e verificado.");
   // Retention runs only after a new verified backup exists.
   const removed=await pruneBackups(keep,env.BACKUP_DIR||"data/backups");if(removed.length)console.info(`Retenção de backups: ${removed.length} arquivo(s) antigo(s) removido(s).`);
  }catch{console.error("Falha no backup automático. Verifique o armazenamento e execute npm run db:backup.");}finally{running=false;}};
 const timer=setInterval(tick,interval);timer.unref();void tick();
 return ()=>{stopped=true;clearInterval(timer);};
}
