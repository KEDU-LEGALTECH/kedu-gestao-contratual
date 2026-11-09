import "dotenv/config";
import {DatabaseSync} from "node:sqlite";
import {copyFile,mkdtemp,readdir,rm,stat} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve,basename} from "node:path";
/** Restoration drill: opens a COPY of a backup in a temporary folder and checks that it can be used.
 * Never touches the database in use. Usage: npm run db:verify-backup [-- caminho.sqlite | --copy]
 * Without a path it checks the newest backup in BACKUP_DIR; with --copy, the newest in BACKUP_COPY_DIR. */
export async function verifyBackup(path:string) {
 const folder=await mkdtemp(join(tmpdir(),"kedu-restauracao-")),copy=join(folder,basename(path));
 try{
  await copyFile(path,copy);
  const db=new DatabaseSync(copy,{readOnly:true});
  try{
   const integrity=(db.prepare("PRAGMA integrity_check").all() as any[]).map(r=>r.integrity_check);
   const foreign=db.prepare("PRAGMA foreign_key_check").all().length;
   const count=(table:string)=>{try{return Number((db.prepare(`SELECT count(*) n FROM ${table}`).get() as any).n);}catch{return null;}};
   const counts=Object.fromEntries(["demands","glpi_tickets","processing_files","users","contract_processing"].map(t=>[t,count(t)]));
   const ok=integrity.length===1&&integrity[0]==="ok"&&!foreign&&counts.demands!==null;
   return {ok,file:path,bytes:(await stat(path)).size,integrity:integrity.join("; ").slice(0,200),foreignKeyProblems:foreign,counts};
  }finally{db.close();}
 }finally{await rm(folder,{recursive:true,force:true});}
}
async function newest(folder:string){
 const names=(await readdir(resolve(folder))).filter(n=>/^kedu-.+\.sqlite$/.test(n)).sort();
 if(!names.length)throw Error("Nenhum backup encontrado em "+folder+".");
 return join(resolve(folder),names.at(-1)!);
}
if(process.argv[1]&&/backup-verify\.ts$/.test(process.argv[1])){
 const arg=process.argv[2];
 const path=arg&&arg!=="--copy"?arg:await newest(arg==="--copy"?process.env.BACKUP_COPY_DIR||"":process.env.BACKUP_DIR||"data/backups");
 const result=await verifyBackup(path);
 console.log(JSON.stringify(result,null,2));
 console.log(result.ok?"RESULTADO: o backup pode ser restaurado.":"RESULTADO: o backup NÃO está apto para restauração.");
 if(!result.ok)process.exitCode=2;
}
