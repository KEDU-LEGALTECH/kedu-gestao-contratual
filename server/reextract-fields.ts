import { db, all, run, audit, sql, auditAsync } from "./db.js";
import {fieldsFromLines,extractProcessingFile} from "./processing-extract.js";
import {saveProcessingResult} from "./contract-processing.js";
import {invalidate} from "./workflow.js";
import {readSpreadsheet} from "./xlsx-reading.js";
import PizZip from "pizzip";

// Local cached originals only. No downloader or helpdesk request is invoked.
const files=await sql.all("SELECT f.* FROM processing_files f JOIN demands d ON d.id=f.demand_id WHERE d.stage NOT IN ('Concluído','Cancelado','Em assinatura')");
const changed=new Set<string>();let before=0,after=0,updated=0;
db.exec("BEGIN IMMEDIATE");
try{
 for(const f of files){
  const old=JSON.parse(f.extracted);if(old.problem || f.problem || !old.text)continue;
  // Spreadsheet fields depend on cell positions and hidden tabs, not on the flattened text; OCR of embedded images needs a full re-read.
  // OCR block readings and PDF tables/parties are not recoverable from the text alone.
  if(/OCR/.test(old.method||'')||/\.pdf$/i.test(f.name))continue;
  const sheet=old.method==='XLSX'?readSpreadsheet(new PizZip(Buffer.from(f.bytes))):undefined;
  const fields=sheet?sheet.fields:/\.docx$/i.test(f.name)?extractProcessingFile(Buffer.from(f.bytes),f.name).fields:fieldsFromLines(old.text.split(/\r?\n/).map((x:string)=>x.trim()).filter(Boolean));
  const calculatedFields=sheet&&Object.keys(sheet.calculatedFields).length?sheet.calculatedFields:undefined;
  before+=Object.keys(old.fields||{}).length;after+=Object.keys(fields).length;
  if(JSON.stringify(fields)===JSON.stringify(old.fields)&&JSON.stringify(calculatedFields)===JSON.stringify(old.calculatedFields))continue;
  await sql.run("UPDATE processing_files SET extracted=? WHERE id=?", JSON.stringify({...old,fields,calculatedFields}), f.id);
  changed.add(f.demand_id);updated++;
 }
 for(const did of changed){await sql.run("UPDATE contract_processing SET revision=revision+1 WHERE demand_id=?", did);await invalidate(did);await saveProcessingResult(did);await auditAsync(did, null, "Campos dos documentos locais reidentificados; originais e correções manuais preservados, sem acesso ao GLPI.");}
 db.exec("COMMIT");
}catch(error){db.exec("ROLLBACK");throw error;}
console.log(JSON.stringify({arquivosConsultados:files.length,arquivosAtualizados:updated,demandasAtualizadas:changed.size,camposAntes:before,camposDepois:after}));
