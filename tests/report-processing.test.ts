import {test,after} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
process.env.DATABASE_PATH=join(mkdtempSync(join(tmpdir(),"kedu-report-processing-")),"test.sqlite");
process.env.NODE_ENV="test";process.env.DEMO_SEED="false";process.env.GLPI_MODE="demo";
const {run,now,hash}=await import("../server/db.js");
const {ensureProcessing,saveProcessingResult}=await import("../server/contract-processing.js");
run("INSERT INTO users VALUES('u','Administrador','admin@test.local','Administrador',?)",hash("senha-de-teste-12345"));
run("INSERT INTO sessions VALUES('session','u',?)",Date.now()+60000);
run("INSERT INTO schools VALUES('s','Escola teste','Escola teste','11.444.777/0001-61','','')");
for(const [id,stage] of [["pending","Recebido"],["canceled","Cancelado"]]){
 run("INSERT INTO demands(id,glpi_id,school_id,type,stage,priority,owner,due,data,created) VALUES(?,?,?,'Contrato educacional',?,'Normal','u','','{}',?)",id,id,"s",stage,now());
 run("INSERT INTO glpi_tickets VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",id,"real","Contrato educacional","2","hash-"+id,JSON.stringify({title:"Contrato educacional",content:"",documents:[]}),"{}","vinculado",id,now(),now(),null);
 ensureProcessing(id);saveProcessingResult(id);
}
const {default:app}=await import("../server/index.js");
const server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.on("listening",r));after(()=>server.close());
const base=`http://127.0.0.1:${(server.address() as any).port}`;
test("Relatório e CSV mostram a etapa de processamento e preservam cancelamentos",async()=>{
 const headers={Cookie:"session=session"},res=await fetch(base+"/api/reports",{headers});assert.equal(res.status,200);const body=await res.json();
 assert.equal(body.byStage.find((r:any)=>r.stage==="Aguardando correção").count,1);
 assert.equal(body.byStage.find((r:any)=>r.stage==="Cancelado").count,1);
 assert.equal(body.divergences.length,1);assert.equal(body.divergences[0].id,"pending");
 const csv=await fetch(base+"/api/reports.csv",{headers});assert.equal(csv.status,200);const text=await csv.text();assert.match(text,/Aguardando correção/);assert.match(text,/Cancelado/);
});
test("Saúde do servidor não exige login nem expõe dados internos",async()=>{
 const res=await fetch(base+"/healthz");assert.equal(res.status,200);assert.deepEqual(await res.json(),{status:"ok"});
});
