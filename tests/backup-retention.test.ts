import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,readdirSync,writeFileSync,utimesSync,existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
const {createVerifiedBackup,pruneBackups,backupKeep,copyBackupOffsite,backupCopyConfig}=await import("../server/backup-service.js");
const {verifyBackup}=await import("../server/backup-verify.js");
const folder=()=>mkdtempSync(join(tmpdir(),"kedu-backups-"));
const name=(minute:number)=>`kedu-2026-11-0${1+Math.floor(minute/60)}T10-${String(minute%60).padStart(2,"0")}-00-000Z-0000000${minute%10}.sqlite`;
test("Retenção mantém os backups automáticos mais recentes e nunca toca em backups com outro nome",async()=>{
 const dir=folder();
 for(const m of [1,2,3,4,5]){writeFileSync(join(dir,name(m)),"x");}
 writeFileSync(join(dir,name(1)+"-wal"),"x");writeFileSync(join(dir,name(1)+"-shm"),"x");
 writeFileSync(join(dir,"antes-limpeza-demonstracao-1792519959568.sqlite"),"x");writeFileSync(join(dir,"last-success.json"),"{}");
 const removed=await pruneBackups(3,dir);
 assert.deepEqual(removed.sort(),[name(1),name(1)+"-shm",name(1)+"-wal",name(2)].sort());
 assert.deepEqual(readdirSync(dir).sort(),[name(3),name(4),name(5),"antes-limpeza-demonstracao-1792519959568.sqlite","last-success.json"].sort());
});
test("Sem BACKUP_KEEP nada é removido; sobras de cópia falha só saem depois de um dia",async()=>{
 const dir=folder();for(const m of [1,2,3])writeFileSync(join(dir,name(m)),"x");
 assert.deepEqual(await pruneBackups(0,dir),[]);assert.equal(readdirSync(dir).length,3);
 const old=join(dir,name(7)+".partial"),fresh=join(dir,name(8)+".partial");writeFileSync(old,"x");writeFileSync(fresh,"x");
 const day=Date.now()-2*86400000;utimesSync(old,day/1000,day/1000);
 await pruneBackups(5,dir);
 assert.equal(existsSync(old),false);assert.equal(existsSync(fresh),true,"cópia possivelmente em andamento é preservada");
 assert.equal(backupKeep({}),0);assert.equal(backupKeep({BACKUP_KEEP:"28"}),28);
 assert.throws(()=>backupKeep({BACKUP_KEEP:"1"}));assert.throws(()=>backupKeep({BACKUP_KEEP:"-2"}));
});
test("Backup que falha na verificação não deixa arquivo .partial",async()=>{
 const dir=folder(),source=join(folder(),"sem-demandas.sqlite");
 const db=new DatabaseSync(source);db.exec("CREATE TABLE outra(id INTEGER)");db.close();
 await assert.rejects(createVerifiedBackup(source,dir));
 assert.deepEqual(readdirSync(dir).filter(f=>f.includes(".partial")),[]);
 const ok=join(folder(),"com-demandas.sqlite"),good=new DatabaseSync(ok);good.exec("CREATE TABLE demands(id TEXT)");good.close();
 const result=await createVerifiedBackup(ok,dir);
 assert.ok(existsSync(result.path));assert.equal(result.demands,0);
});
test("Cópia externa é diária, conferida por checksum e mantém só as mais recentes",async()=>{
 const local=folder(),offsite=folder(),src=join(local,name(1));writeFileSync(src,"backup-1");
 const day=86400000,base=Date.parse("2026-11-09T12:00:00Z");
 const first=await copyBackupOffsite(src,offsite,2,base);
 assert.equal(first.copied,true);assert.equal(readdirSync(offsite).join(),name(1));
 const src2=join(local,name(2));writeFileSync(src2,"backup-2");
 assert.equal((await copyBackupOffsite(src2,offsite,2,Date.now())).copied,false,"menos de 20 horas desde a última cópia");
 const old=Date.now()/1000-2*day/1000;utimesSync(join(offsite,name(1)),old,old);
 assert.equal((await copyBackupOffsite(src2,offsite,2,Date.now())).copied,true);
 const src3=join(local,name(3));writeFileSync(src3,"backup-3");utimesSync(join(offsite,name(2)),old,old);
 const third=await copyBackupOffsite(src3,offsite,2,Date.now());
 assert.deepEqual(third.removed,[name(1)]);assert.deepEqual(readdirSync(offsite).sort(),[name(2),name(3)]);
 assert.equal(readdirSync(offsite).some(n=>n.endsWith(".partial")),false);
 assert.deepEqual(backupCopyConfig({}),{dir:"",keep:14});assert.throws(()=>backupCopyConfig({BACKUP_COPY_KEEP:"0"}));
});
test("Teste de restauração abre uma cópia, confere integridade e não altera o original",async()=>{
 const source=join(folder(),"origem.sqlite"),db=new DatabaseSync(source);db.exec("CREATE TABLE demands(id TEXT);INSERT INTO demands VALUES('d1');CREATE TABLE users(id TEXT)");db.close();
 const backup=await createVerifiedBackup(source,folder());
 const before=readdirSync(join(backup.path,"..")).length;
 const result=await verifyBackup(backup.path);
 assert.equal(result.ok,true);assert.equal(result.counts.demands,1);assert.equal(result.counts.glpi_tickets,null);
 assert.equal(readdirSync(join(backup.path,"..")).length,before,"nada é criado ao lado do backup");
 const broken=join(folder(),"quebrado.sqlite");writeFileSync(broken,"isto não é um banco");
 await assert.rejects(verifyBackup(broken));
});
