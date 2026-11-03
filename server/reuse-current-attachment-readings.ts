import {mkdirSync,writeFileSync} from 'node:fs';
import {all,run,db,id,now,audit} from './db.js';
import {matchesImportedAttachment} from './attachment-cache-proof.js';
import {createVerifiedBackup} from './backup-service.js';
import {saveProcessingResult} from './contract-processing.js';

const apply=process.argv.includes('--apply'),backup=apply?await createVerifiedBackup():null;
const rows=all("SELECT d.id,t.hash,t.payload FROM demands d JOIN glpi_tickets t ON t.external_id=d.glpi_id WHERE t.mode='real' AND d.stage NOT IN('Concluído','Cancelado','Em assinatura')");
const reused:any[]=[];const changed=new Set<string>();
if(apply)db.exec('BEGIN IMMEDIATE');
try{
 for(const row of rows)for(const doc of JSON.parse(row.payload).documents||[]){
  if(all('SELECT id FROM processing_files WHERE demand_id=? AND document_id=? AND ticket_hash=? AND length(bytes)>0',row.id,String(doc.id),row.hash).length)continue;
  const source=all('SELECT * FROM processing_files WHERE demand_id=? AND document_id=? AND length(bytes)>0 ORDER BY rowid DESC',row.id,String(doc.id)).find(f=>matchesImportedAttachment(Buffer.from(f.bytes),doc.sha1));
  if(!source)continue;
  reused.push({demand:row.id,documentId:String(doc.id),sourceFileId:source.id,name:doc.name||source.name});changed.add(row.id);
  if(apply){
   const current=all('SELECT hash FROM glpi_tickets t JOIN demands d ON d.glpi_id=t.external_id WHERE d.id=?',row.id)[0];if(current?.hash!==row.hash)throw Error('Chamado mudou durante o reaproveitamento; nenhuma alteração foi aplicada.');
   run('INSERT OR IGNORE INTO processing_files VALUES(?,?,?,?,?,?,?,?,?,?)',id(),row.id,String(doc.id),row.hash,doc.name||source.name,source.mime,source.bytes,source.extracted,source.problem,now());
  }
 }
 if(apply){for(const did of changed){saveProcessingResult(did);audit(did,null,'Leitura anterior reaproveitada na versão atual após conferir o SHA-1 importado do GLPI com os bytes locais. Nenhum OCR ou confirmação humana foi criado.');}db.exec('COMMIT');}
}catch(e){if(apply)db.exec('ROLLBACK');throw e;}
mkdirSync('data/attachment-reuse',{recursive:true});const path='data/attachment-reuse/'+Date.now()+(apply?'-applied':'-preview')+'.json';writeFileSync(path,JSON.stringify({apply,backup:backup?.path,reused},null,2));console.log(JSON.stringify({apply,files:reused.length,demands:changed.size,report:path}));db.close();
