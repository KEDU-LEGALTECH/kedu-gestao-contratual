import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import express from 'express';
process.env.NODE_ENV='test';process.env.DEMO_SEED='false';
process.env.DATABASE_PATH=join(mkdtempSync(join(tmpdir(),'kedu-progress-')),'test.sqlite');
const {run,db,now}=await import('../server/db.js');
const {registerProcessingRoutes}=await import('../server/processing-routes.js');
run("INSERT INTO users VALUES('u','Teste','progress@test.local','Administrador','unused')");
for(const id of ['d1','d2']){
 run("INSERT INTO demands(id,glpi_id,type,stage,priority,owner,due,data,created) VALUES(?,?,'Contrato','Recebido','Normal','u','','{}',?)",id,id,now());
 run("INSERT INTO glpi_tickets VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",id,'real','Chamado','2','hash-'+id,JSON.stringify({documents:[{id:'7',name:'Contrato.pdf'}],documentsAvailable:true}),'{}','vinculado',id,now(),now(),null);
 run("INSERT INTO reading_jobs(demand_id,ticket_hash,state,available_at,updated) VALUES(?,?,'queued',0,0)",id,'hash-'+id);
}
const app=express();app.use((req:any,_res,next)=>{req.user={id:'u',role:req.headers['x-role']||'Administrador'};next();});registerProcessingRoutes(app);
app.use((err:any,_req:any,res:any,_next:any)=>res.status(err.status||400).json({error:err.message}));
const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.on('listening',resolve));
after(()=>{server.close();db.close();});
const base=`http://127.0.0.1:${(server.address() as any).port}/api/processing/progress`;
test('andamento respeita IDs filtrados, recorte vazio e permissões',async()=>{
 const response=await fetch(base+'?ids=d1');assert.equal(response.status,200);assert.match(response.headers.get('cache-control')||'',/no-store/);
 const data=await response.json();assert.equal(data.total,1);assert.equal(data.counts.queued,1);assert.equal(data.files[0].demandId,'d1');
 assert.equal((await(await fetch(base+'?ids=')).json()).total,0);
 assert.equal((await fetch(base+'?ids=d1',{headers:{'x-role':'Consulta'}})).status,403);
});
