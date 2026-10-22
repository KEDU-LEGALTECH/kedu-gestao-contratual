import "dotenv/config";
import {DatabaseSync} from "node:sqlite";
import {mkdir,writeFile,readFile} from "node:fs/promises";
import {resolve,join} from "node:path";
import {createHash} from "node:crypto";
import {createVerifiedBackup} from "./backup-service.js";
const hash=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
/** Offline preparation, read-only source. No uploading and no SQL translation guesses. */
export async function prepareMigration(source=process.env.DATABASE_PATH||"data/kedu.sqlite",root="data/migration") {
 const folder=resolve(root,new Date().toISOString().replace(/[:.]/g,"-"));await mkdir(folder,{recursive:true});
 const backup=await createVerifiedBackup(source,folder),db=new DatabaseSync(backup.path,{readOnly:true});
 try {
  const schema=db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY type,name").all();
  const tables=(schema as any[]).filter(o=>o.type==="table");
  const inventory=tables.map(t=>{
   const name='"'+t.name.replaceAll('"','""')+'"';
   return {table:t.name,rows:Number((db.prepare(`SELECT count(*) n FROM ${name}`).get() as any).n),columns:db.prepare(`PRAGMA table_info(${name})`).all(),foreignKeys:db.prepare(`PRAGMA foreign_key_list(${name})`).all()};
  });
  const objects:any[]=[];const objectDir=join(folder,"objects");await mkdir(objectDir);
  for(const table of inventory){
   const blobs=(table.columns as any[]).filter(c=>c.type.toUpperCase()==="BLOB");
   for(const column of blobs){
    const q=(s:string)=>'"'+s.replaceAll('"','""')+'"';
    const primary=(table.columns as any[]).filter(c=>c.pk).map(c=>c.name);if(!primary.length)throw Error("Arquivo sem chave primária para rastreamento.");
    const rows=db.prepare(`SELECT ${primary.map(q).join(',')},${q(column.name)} AS payload FROM ${q(table.table)} WHERE ${q(column.name)} IS NOT NULL`).all() as any[];
    for(const row of rows){const bytes=Buffer.from(row.payload),digest=hash(bytes);if(!bytes.length)continue;const path=join(objectDir,digest+".bin");await writeFile(path,bytes,{mode:0o600});if(hash(await readFile(path))!==digest)throw Error("Arquivo extraído não passou na validação.");objects.push({table:table.table,key:Object.fromEntries(primary.map(k=>[k,row[k]])),column:column.name,sha256:digest,size:bytes.length,object:"objects/"+digest+".bin"});}
   }
  }
  const snapshotHash=hash(await readFile(backup.path));
  const manifest={created:backup.created,runtimeDatabase:"sqlite",remoteWrites:0,snapshot:backup.path.split(/[\\/]/).at(-1),snapshotHash,tables:inventory,objects,excludedFromFutureMigration:["sessions"],pending:["Converter schema, consultas e transações para PostgreSQL","Portar gatilhos, imutabilidade e numeração concorrente","Migrar arquivos para bucket privado e referências","Recriar sessões e testar permissões por perfil","Verificar contagens, hashes e restauração antes da troca"]};
  await writeFile(join(folder,"manifest.json"),JSON.stringify(manifest,null,2),{mode:0o600});
  await writeFile(join(folder,"schema-sqlite.json"),JSON.stringify(schema,null,2),{mode:0o600});
  return {folder,tables:inventory.length,files:objects.length};
 }finally{db.close();}
}
if(process.argv[1]?.replaceAll("\\","/").endsWith("/migration-inventory.ts"))prepareMigration().then(r=>console.log(JSON.stringify(r))).catch(()=>{console.error("Preparação da migração falhou. Nenhum dado foi enviado ao Supabase; verifique origem e armazenamento local.");process.exitCode=1;});
