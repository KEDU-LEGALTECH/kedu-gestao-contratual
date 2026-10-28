import 'dotenv/config';
import {DatabaseSync} from 'node:sqlite';
import {writeFileSync} from 'node:fs';
import {missingFieldEvidence} from './document-evidence.js';
const db=new DatabaseSync(process.env.DATABASE_PATH||'data/kedu.sqlite',{readOnly:true});
try{
 const rows=db.prepare(`SELECT p.demand_id,p.result,p.status,t.payload,t.hash FROM contract_processing p JOIN demands d ON d.id=p.demand_id JOIN glpi_tickets t ON t.external_id=d.glpi_id AND t.mode='real' WHERE d.stage NOT IN('Concluído','Cancelado','Em assinatura')`).all() as any[];
 const totals:Record<string,number>={},missing:Record<string,number>={},formats:Record<string,number>={};let partial=0,files=0;
 for(const row of rows){
  const result=JSON.parse(row.result),raw=JSON.parse(row.payload);
  const current=db.prepare('SELECT * FROM processing_files WHERE demand_id=? ORDER BY rowid DESC').all(row.demand_id) as any[];
  const docs=(raw.documents||[]).map((doc:any)=>{const file=current.find(f=>f.document_id===String(doc.id)&&(f.ticket_hash===row.hash||f.ticket_hash.startsWith(row.hash+':correction:'))),e=file?JSON.parse(file.extracted):{};return {name:file?.name||doc.name||'Anexo',text:e.text||'',incomplete:e.incomplete,problem:file?.problem||(!file?'Não obtido':'')};});
  for(const doc of docs){files++;if(doc.incomplete)partial++;const format=doc.name.split('.').pop()?.toLowerCase()||'outro';formats[format]=(formats[format]||0)+1;}
  for(const c of result.comparisons||[]){totals[c.status]=(totals[c.status]||0)+1;if(c.status==='missing'){const evidence=missingFieldEvidence(c.field,docs);missing[evidence.reason]=(missing[evidence.reason]||0)+1;}}
 }
 const report={created:new Date().toISOString(),demands:rows.length,files,partial,formats,comparisons:totals,missingReasons:missing};
 const path=process.argv[2]||'data/reading-improvement-audit.json';writeFileSync(path,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{db.close();}
