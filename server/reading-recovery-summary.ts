import 'dotenv/config';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
if(!process.argv[2])throw Error('Informe o backup anterior às alterações.');
const before=new DatabaseSync(process.argv[2],{readOnly:true}),after=new DatabaseSync(process.env.DATABASE_PATH||'data/kedu.sqlite',{readOnly:true});
try{
 const rows=after.prepare(`SELECT f.* FROM processing_files f JOIN demands d ON d.id=f.demand_id JOIN glpi_tickets t ON t.external_id=d.glpi_id AND t.mode='real'
 WHERE d.stage NOT IN('Concluído','Cancelado','Em assinatura') AND (f.ticket_hash=t.hash OR f.ticket_hash LIKE t.hash||':correction:%') ORDER BY f.rowid DESC`).all() as any[];
 const seen=new Set<string>(),gains:any[]=[],losses:any[]=[];let examined=0,bytesChanged=0,fieldsBefore=0,fieldsAfter=0;
 for(const row of rows){
  const key=row.demand_id+'\0'+row.document_id;if(seen.has(key))continue;seen.add(key);
  const previous=before.prepare('SELECT bytes,extracted FROM processing_files WHERE id=?').get(row.id) as any;if(!previous)continue;examined++;
  const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');if(hash(previous.bytes)!==hash(row.bytes))bytesChanged++;
  const a=JSON.parse(previous.extracted).fields||{},b=JSON.parse(row.extracted).fields||{};fieldsBefore+=Object.keys(a).length;fieldsAfter+=Object.keys(b).length;
  const added=Object.keys(b).filter(k=>!a[k]?.length),removed=Object.keys(a).filter(k=>!b[k]?.length);
  if(added.length)gains.push({file:row.name,fields:added});if(removed.length)losses.push({file:row.name,fields:removed});
 }
 const report={created:new Date().toISOString(),examined,bytesChanged,fieldsBefore,fieldsAfter,gains,losses};
 writeFileSync('data/reading-recovery-summary.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{before.close();after.close();}
