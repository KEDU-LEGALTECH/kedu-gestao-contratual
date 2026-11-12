import 'dotenv/config';
import {createVerifiedBackup} from './backup-service.js';
import {writeFileSync} from 'node:fs';
if(!process.argv.includes('--apply'))throw Error('Use --apply: o comando cria backup, relê arquivos digitais e recupera campos do texto já lido, sem executar OCR.');
console.log('Backup verificado:',(await createVerifiedBackup()).path);
const ocrPartial=process.argv.includes('--ocr-partial');
const {db,all,one,run,now,audit}=await import('./db.js');
const {readNativePdf}=await import('./file-reading-engine.js');
const {readProcessingFile}=await import('./file-reading.js');
const {recoverTextFields}=await import('./text-recovery.js');
const {plausibleFieldValue}=await import('./field-plausibility.js');
const {mergeExtractedFields}=await import('./processing-extract.js');
const {sameRequestedValue}=await import('./request-expectations.js');
const {saveProcessingResult}=await import('./contract-processing.js');
const {sha256}=await import('./official-templates.js');
const changed:any[]=[],skipped:any[]=[];let examined=0;
for(const d of all(`SELECT d.id,t.hash FROM demands d JOIN glpi_tickets t ON t.external_id=d.glpi_id AND t.mode='real' WHERE d.stage NOT IN('Concluído','Cancelado','Em assinatura')`)){
 const current=all('SELECT * FROM processing_files WHERE demand_id=? ORDER BY rowid DESC',d.id).filter(f=>f.ticket_hash===d.hash||f.ticket_hash.startsWith(d.hash+':correction:'));
 for(const [index,file] of current.entries()){
  if(current.findIndex(f=>f.document_id===file.document_id)!==index||!file.bytes.length)continue;
  examined++;const old=JSON.parse(file.extracted),originalHash=sha256(Buffer.from(file.bytes));
  // Never replace a transcription already checked by a human.
  if(one('SELECT file_id FROM processing_field_reviews WHERE file_id=? AND extraction_hash=?',file.id,sha256(Buffer.from(file.extracted)))||one('SELECT file_id FROM processing_file_reviews WHERE file_id=? AND extraction_hash=?',file.id,sha256(Buffer.from(file.extracted))))continue;
  let reading={...old,fields:structuredClone(old.fields||{})},reason='';
  if(Buffer.from(file.bytes).subarray(0,5).toString()==='%PDF-'&&(ocrPartial?(old.incomplete||!!file.problem):(old.incomplete||file.problem||/OCR/.test(old.method||'')))){
   try{
    console.log(ocrPartial?'Relendo PDF parcial:':'Verificando camada digital:',file.name);
    const native=ocrPartial?await readProcessingFile(Buffer.from(file.bytes),file.name):await readNativePdf(Buffer.from(file.bytes));
    const lost=Object.entries(old.fields||{}).some(([key,values]:any)=>values.some((v:string)=>!(native.fields[key]||[]).some(n=>sameRequestedValue(key,v,n))));
    if(!native.problem&&!lost&&(!native.incomplete||ocrPartial)){reading=native;reason=native.incomplete?'Leitura parcial atualizada sem perda de campos; páginas pendentes continuam sinalizadas.':ocrPartial?'PDF relido com orçamento por página; nenhuma perda de campo anterior.':'Camada digital completa recuperada; nenhuma perda de campo anterior.';}
    else skipped.push({file:file.id,reason:lost?'Recuperação automática preservou a leitura antiga para evitar perda de campos.':'PDF ainda inconclusivo.'});
   }catch{skipped.push({file:file.id,reason:'PDF ainda precisa de OCR; original preservado.'});}
  }
  // Digital files (DOCX, PDF text layer, spreadsheets) are re-read in seconds with the current extractors.
  // Office files that failed with an older reader (e.g. text limit) are re-read too; a partial result keeps its warning.
  const office=/\.(docx|xlsx|odt|pptx)$/i.test(file.name);
  if(!reason&&((!/OCR|inconclusiva/i.test(old.method||'')&&!file.problem&&!old.incomplete)||(office&&file.problem))){
   try{
    const fresh=await readProcessingFile(Buffer.from(file.bytes),file.name);
    const lost=Object.entries(old.fields||{}).some(([key,values]:any)=>values.some((v:string)=>plausibleFieldValue(key,v)&&!(fresh.fields[key]||[]).some((n:string)=>sameRequestedValue(key,v,n))));
    if(!fresh.problem&&(!fresh.incomplete||file.problem)&&!lost&&(file.problem||JSON.stringify(fresh.fields)!==JSON.stringify(old.fields))){reading=fresh;reason=file.problem?'Arquivo antes recusado relido com o leitor atual'+(fresh.incomplete?' (leitura parcial preservada e sinalizada).':'.'):'Arquivo digital relido com os extratores atuais; nenhum campo anterior perdido.';}
   }catch{}
  }
  const before=JSON.stringify(reading.fields);mergeExtractedFields(reading.fields,recoverTextFields(reading.text||'',reading.fields));
  if(JSON.stringify(reading.fields)!==before)reason+=(reason?' ':'')+'Campos recuperados de qualificação das partes, dados bancários ou cláusula de representação.';
  if(!reason)continue;
  db.exec('BEGIN IMMEDIATE');try{
   const live=one('SELECT extracted,bytes FROM processing_files WHERE id=?',file.id);
   if(live?.extracted!==file.extracted||sha256(Buffer.from(live.bytes))!==originalHash||one('SELECT hash FROM glpi_tickets WHERE demand_id=?',d.id)?.hash!==d.hash||one('SELECT status FROM contract_processing WHERE demand_id=?',d.id)?.status==='Analisando'){db.exec('ROLLBACK');continue;}
   run('UPDATE processing_files SET extracted=?,problem=? WHERE id=?',JSON.stringify(reading),reading.problem||'',file.id);
   run('UPDATE contract_processing SET revision=revision+1,updated=? WHERE demand_id=?',now(),d.id);
   audit(d.id,null,'Recuperação local da leitura; bytes originais preservados: '+file.name+'. '+reason);
   db.exec('COMMIT');changed.push({demand:d.id,file:file.id,name:file.name,reason});console.log('Recuperado:',file.name);
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 if(one('SELECT status FROM contract_processing WHERE demand_id=?',d.id)?.status!=='Analisando')await saveProcessingResult(d.id);
}
const report={created:now(),examined,changed,skipped};writeFileSync('data/reading-recovery-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({examined,recovered:changed.length,stillNeedsOcr:skipped.length}));db.close();
