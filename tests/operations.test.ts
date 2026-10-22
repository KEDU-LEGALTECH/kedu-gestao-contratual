import {test} from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {mkdtemp,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {createVerifiedBackup,backupInterval,startBackups} from "../server/backup-service.js";
import {prepareMigration} from "../server/migration-inventory.js";
import {supabaseConfig} from "../server/supabase-config.js";

test("Backup inclui WAL, verifica cópia e mantém original; inventário preserva hashes dos arquivos",async()=>{
 const root=await mkdtemp(join(tmpdir(),"kedu-ops-")),source=join(root,"source.sqlite"),db=new DatabaseSync(source);
 db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE demands(id TEXT PRIMARY KEY); CREATE TABLE files(id TEXT PRIMARY KEY,demand_id TEXT REFERENCES demands(id),bytes BLOB); INSERT INTO demands VALUES('d');");
 const bytes=Buffer.from("documento de teste");db.prepare("INSERT INTO files VALUES('f','d',?)").run(bytes);
 const copy=await createVerifiedBackup(source,join(root,"backups"));assert.equal(copy.demands,1);
 const restored=new DatabaseSync(copy.path,{readOnly:true});assert.deepEqual(Buffer.from((restored.prepare("SELECT bytes FROM files").get() as any).bytes),bytes);restored.close();
 const inventory=await prepareMigration(source,join(root,"migration")),manifest=JSON.parse(await readFile(join(inventory.folder,"manifest.json"),"utf8"));
 assert.equal(manifest.remoteWrites,0);assert.equal(inventory.files,1);assert.equal(manifest.objects[0].sha256,createHash("sha256").update(bytes).digest("hex"));
 assert.deepEqual(await readFile(join(inventory.folder,manifest.objects[0].object)),bytes);
 assert.equal((db.prepare("SELECT COUNT(*) n FROM demands").get() as any).n,1);db.close();
});
test("Backup rejeita referência corrompida em vez de anunciar sucesso",async()=>{
 const root=await mkdtemp(join(tmpdir(),"kedu-bad-")),source=join(root,"source.sqlite"),db=new DatabaseSync(source);
 db.exec("PRAGMA foreign_keys=OFF; CREATE TABLE demands(id TEXT PRIMARY KEY); CREATE TABLE child(id TEXT PRIMARY KEY,parent TEXT REFERENCES demands(id)); INSERT INTO child VALUES('bad','missing');");db.close();
 await assert.rejects(createVerifiedBackup(source,join(root,"backups")),/inválido/);
});
test("Agendamento de backups é opt-in, validado e desativado nos testes",()=>{
 assert.equal(backupInterval({}),0);assert.equal(backupInterval({BACKUP_INTERVAL_HOURS:"6"}),21600000);
 for(const value of ["abc","-1","0.01","169"])assert.throws(()=>backupInterval({BACKUP_INTERVAL_HOURS:value}));
 let calls=0;startBackups({NODE_ENV:"test",BACKUP_INTERVAL_HOURS:"6"},async()=>{calls++;return {} as any;})();assert.equal(calls,0);
});
test("Configuração Supabase usa TLS verificado, valida projeto e não aceita conexão enfraquecida",()=>{
 const env={SUPABASE_URL:"https://projetoteste.supabase.co",SUPABASE_DATABASE_URL:"postgresql://postgres:senha-ficticia@db.projetoteste.supabase.co:5432/postgres?sslmode=verify-full"};
 const c=supabaseConfig(env);assert.equal(c.ssl.rejectUnauthorized,true);assert.equal(c.connection.includes("sslmode"),false);assert.equal(c.bucket,"kedu-documentos");
 assert.doesNotThrow(()=>supabaseConfig({...env,SUPABASE_DATABASE_URL:"postgresql://postgres.projetoteste:senha-ficticia@aws-0-region.pooler.supabase.com:5432/postgres"}));
 for(const override of [{SUPABASE_URL:"http://projetoteste.supabase.co"},{SUPABASE_DATABASE_URL:env.SUPABASE_DATABASE_URL.replace("verify-full","disable")},{SUPABASE_DATABASE_URL:env.SUPABASE_DATABASE_URL.replace("db.projetoteste","db.outroprojeto")},{SUPABASE_STORAGE_BUCKET:"../publico"}])assert.throws(()=>supabaseConfig({...env,...override}));
 assert.throws(()=>supabaseConfig({}),/Configure/);
});
