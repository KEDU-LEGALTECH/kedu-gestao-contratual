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
for(const [id,stage,status] of [["pending","Recebido","2"],["canceled","Cancelado","2"],["solved","Recebido","5"],["closed","Recebido","6"]]){
 run("INSERT INTO demands(id,glpi_id,school_id,type,stage,priority,owner,due,data,created) VALUES(?,?,?,'Contrato educacional',?,'Normal','u',?,'{}',?)",id,id,"s",stage,["solved","closed"].includes(id)?"2000-01-01":"",now());
 run("INSERT INTO glpi_tickets VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",id,"real","Contrato educacional",status,"hash-"+id,JSON.stringify({title:"Contrato educacional",content:"",documents:[]}),"{}","vinculado",id,now(),now(),null);
 ensureProcessing(id);saveProcessingResult(id);
}
const {default:app}=await import("../server/index.js");
const server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.on("listening",r));after(()=>server.close());
const base=`http://127.0.0.1:${(server.address() as any).port}`;
test("Relatório e CSV mostram a etapa de processamento e preservam cancelamentos",async()=>{
 const headers={Cookie:"session=session"},res=await fetch(base+"/api/reports",{headers});assert.equal(res.status,200);const body=await res.json();
 assert.equal(body.byStage.find((r:any)=>r.stage==="Aguardando análise").count,1);
 assert.equal(body.byStage.find((r:any)=>r.stage==="Cancelado").count,1);
 assert.equal(body.divergences.length,1);assert.equal(body.divergences[0].id,"pending");
 const csv=await fetch(base+"/api/reports.csv",{headers});assert.equal(csv.status,200);const text=await csv.text();assert.match(text,/Aguardando análise/);assert.match(text,/Cancelado/);
});
test("Relatório separa chamados encerrados no GLPI sem apagar suas pendências",async()=>{
 const headers={Cookie:"session=session"},body=await (await fetch(base+"/api/reports",{headers})).json();
 assert.equal(body.byStage.find((r:any)=>r.stage==="Solucionado no GLPI").count,1);
 assert.equal(body.byStage.find((r:any)=>r.stage==="Fechado no GLPI").count,1);
 assert.ok(!body.divergences.some((d:any)=>["solved","closed"].includes(d.id)));
 assert.deepEqual(body.closedPendencies.map((d:any)=>[d.id,d.status,d.glpiStage]).sort(),[["closed","Aguardando análise","Fechado no GLPI"],["solved","Aguardando análise","Solucionado no GLPI"]]);
 assert.equal(body.overdue,0);
 const text=await (await fetch(base+"/api/reports.csv",{headers})).text();assert.match(text,/Solucionado no GLPI/);assert.match(text,/Fechado no GLPI/);
 // List and report share one stage rule, so both give the same count for the same demands.
 const {demandDisplayStage}=await import('../shared/glpi-ticket-meta.js');
 const boot=await (await fetch(base+"/api/bootstrap",{headers})).json();
 for(const stage of ["Aguardando análise","Solucionado no GLPI","Fechado no GLPI"])assert.equal(boot.demands.filter((d:any)=>demandDisplayStage(d)===stage).length,body.byStage.find((r:any)=>r.stage===stage).count);
});
test("Saúde do servidor não exige login nem expõe dados internos",async()=>{
 const res=await fetch(base+"/healthz");assert.equal(res.status,200);assert.deepEqual(await res.json(),{status:"ok"});
});
test("Bootstrap entrega status e prioridade da origem para as abas de Demandas",async()=>{
 run("UPDATE glpi_tickets SET status='4',payload=json_set(payload,'$.priority','5') WHERE external_id='pending'");
 const res=await fetch(base+"/api/bootstrap",{headers:{Cookie:"session=session"}});assert.equal(res.status,200);
 const body=await res.json();const d=body.demands.find((d:any)=>d.id==='pending');
 assert.deepEqual(d.glpiOrigin,{status:'4',priority:'5'});
 const {matchesDemandQueue}=await import('../shared/glpi-ticket-meta.js');
 assert.equal(body.demands.filter((d:any)=>matchesDemandQueue(d,'pending')).length,1);
 assert.equal(body.demands.filter((d:any)=>matchesDemandQueue(d,'open')).length,1);
});
