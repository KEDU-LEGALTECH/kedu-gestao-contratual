import {db,all,run,audit} from "./db.js";
import {fieldsFromLines,extractProcessingFile} from "./processing-extract.js";
import {saveProcessingResult} from "./contract-processing.js";
import {invalidate} from "./workflow.js";

// Local cached originals only. No downloader or helpdesk request is invoked.
const files=all("SELECT f.* FROM processing_files f JOIN demands d ON d.id=f.demand_id WHERE d.stage NOT IN ('Concluído','Cancelado','Em assinatura')");
const changed=new Set<string>();let before=0,after=0,updated=0;
db.exec("BEGIN IMMEDIATE");
try{
 for(const f of files){
  const old=JSON.parse(f.extracted);if(old.problem || f.problem || !old.text)continue;
  const fields=/\.docx$/i.test(f.name)?extractProcessingFile(Buffer.from(f.bytes),f.name).fields:fieldsFromLines(old.text.split(/\r?\n/).map((x:string)=>x.trim()).filter(Boolean));
  before+=Object.keys(old.fields||{}).length;after+=Object.keys(fields).length;
  if(JSON.stringify(fields)===JSON.stringify(old.fields))continue;
  run("UPDATE processing_files SET extracted=? WHERE id=?",JSON.stringify({...old,fields}),f.id);
  changed.add(f.demand_id);updated++;
 }
 for(const did of changed){run("UPDATE contract_processing SET revision=revision+1 WHERE demand_id=?",did);invalidate(did);saveProcessingResult(did);audit(did,null,"Campos dos documentos locais reidentificados; originais e correções manuais preservados, sem acesso ao GLPI.");}
 db.exec("COMMIT");
}catch(error){db.exec("ROLLBACK");throw error;}
console.log(JSON.stringify({arquivosConsultados:files.length,arquivosAtualizados:updated,demandasAtualizadas:changed.size,camposAntes:before,camposDepois:after}));
