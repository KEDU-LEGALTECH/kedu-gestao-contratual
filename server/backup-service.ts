import {DatabaseSync,backup} from "node:sqlite";
import {mkdir,rename,writeFile} from "node:fs/promises";
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
 const live=new DatabaseSync(resolve(source),{readOnly:true});
 try{await backup(live,partial);}finally{live.close();}
 const restored=new DatabaseSync(partial,{readOnly:true});let demands=0;
 try {
  const integrity=restored.prepare("PRAGMA integrity_check").all() as any[];
  if(integrity.length!==1 || integrity[0].integrity_check!=="ok" || restored.prepare("PRAGMA foreign_key_check").all().length)throw Error("Backup inválido: integridade ou referências inconsistentes.");
  demands=Number((restored.prepare("SELECT COUNT(*) n FROM demands").get() as any).n);
 }finally{restored.close();}
 await rename(partial,target);
 const result={path:target,created:new Date().toISOString(),demands,integrity:"ok"};
 await writeFile(join(directory,"last-success.json"),JSON.stringify(result,null,2),{mode:0o600});
 return result;
}
export function startBackups(env:NodeJS.ProcessEnv=process.env,execute=()=>createVerifiedBackup()) {
 const interval=backupInterval(env);if(!interval || env.NODE_ENV==="test")return ()=>{};
 let running=false,stopped=false;
 const tick=async()=>{if(running || stopped)return;running=true;try{await execute();console.info("Backup automático concluído e verificado.");}catch{console.error("Falha no backup automático. Verifique o armazenamento e execute npm run db:backup.");}finally{running=false;}};
 const timer=setInterval(tick,interval);timer.unref();void tick();
 return ()=>{stopped=true;clearInterval(timer);};
}
