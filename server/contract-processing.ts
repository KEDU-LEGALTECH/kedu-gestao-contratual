import {qualifiedCompanyName} from './qualification-reading.js';
import {readingDoubt} from "./reading-doubt.js";
import {contractReadingScope,isBankDocument,isFilledContract,isSupportDocument} from './contract-reading-scope.js';
import {readingFilename} from './reading-format.js';
import { all, one, run, db, id, now, audit, sql, auditAsync } from "./db.js";
import { downloadGlpiAttachment } from "./glpi-download.js";
import { analyzeTicket,htmlToText,validCnpj } from "./glpi-analysis.js";
import { extractProcessingFile,fieldsFromLines,normalizeValue,inputLabels,norm,editableKeys } from "./processing-extract.js";
import { details } from "./governance.js";
import { listOfficial,sourceOf,homologated,sha256 } from "./official-templates.js";
import { byteHeadSql,byteSizeSql,fileBytes,saveProcessingFile,storedHash } from "./processing-files.js";
import { readCache } from "./sql.js";
import { role } from "./role.js";
import { readerAvailable } from "./paddle-ocr.js";
import { officialRequired,officialProblems,deriveOfficial,derivedFrom } from "../shared/official-fields.js";
import { validateData } from "../shared/data-validation.js";
import { wholeMonths } from "../shared/extenso.js";
import { generate,review } from "./documents.js";
import { readProcessingFile,readerVersion } from "./file-reading.js";
import { invalidate } from "./workflow.js";
import {conversationReferences,requestCompanyReferences,sameRequestedValue,distinctRequestedValues,corroboratedDecimalCnpj} from './request-expectations.js';
import {identifyDocumentHeading,receivedDocumentKind} from '../shared/document-heading.js';
import {attachmentRole,fieldsForRole,automaticReadingCheck,unusedPersonalId} from './reading-policy.js';
import {scopePartyReading,extractContractParties,selectContractParty} from './contract-parties.js';
import {fieldExcerpt,readingGuidance,proposedChanges} from './reading-guidance.js';
import {processingStatus} from './processing-status.js';
import {pendingReason} from '../shared/pending-reason.js';
import {demandArea} from '../shared/demand-report.js';
import {missingFieldEvidence} from './document-evidence.js';
import {validateReadings} from './reading-validation.js';
import {ReadingJobQueue} from './reading-job-queue.js';
import {preservePreviousReading} from './reading-recovery-policy.js';
import {identityEvidence} from './identity-evidence.js';
import {withDocumentAddress,hasDigitalField,qualifiedNameNeedsReview,digitalFieldOrigin,headerTradeName,legalFormReferenceNeedsReview,referenceTradeNameNeedsReview} from './comparison-evidence.js';
import {recoverTextFields,labelledLocationExcerpt} from './text-recovery.js';
import {assistedVisualField,assistedVisualAbsence} from './assisted-visual-evidence.js';
import {readWithVision,visionConfig,visionSignature,shouldReadVision} from './vision-reading.js';
import {plausibleFieldValue,ownIdentity} from './field-plausibility.js';
import {guidedConfirmation,attachmentWithValue} from './guided-confirmation.js';
import {supersededDocuments} from './document-versions.js';
import {notApplicableReason,cessionClauseCheck} from './comparison-profile.js';
import {comparisonReviewReason} from './comparison-review-reason.js';
import {matchesImportedAttachment} from './attachment-cache-proof.js';
import {targetedReadingTargets,mergeTargetedReading} from './targeted-reading.js';
import {comparisonSources} from './comparison-sources.js';
import {fileProgress} from './file-progress.js';
import {readDoclingPage,doclingConfig} from './docling-reader.js';
import {setImmediate as yieldToServer} from "node:timers/promises";
// Tiny images without any text (logos, signatures, illustrations) are not unreadable documents.
const textHead=2000;
/** receivedDocumentTypes of every demand. Only the start of each saved text is read: the kind depends on
 * the first ten non-empty lines, and a text cut before ten complete lines is read in full. */
export async function receivedDocumentTypesAll() {
 const tickets=await sql.all("SELECT d.id AS demand_id,t.hash,json_extract(t.payload,'$.documents') AS documents FROM demands d JOIN glpi_tickets t ON t.external_id=d.glpi_id AND t.mode='real'");
 // Only files of the current ticket version, or corrections made on it, can be listed.
 const files=await sql.all(`SELECT f.id,f.demand_id,f.document_id,f.ticket_hash,f.name,substr(coalesce(json_extract(f.extracted,'$.text'),''),1,${textHead}) AS text_head,
  length(coalesce(json_extract(f.extracted,'$.text'),'')) AS text_length FROM processing_files f JOIN demands d ON d.id=f.demand_id
  JOIN glpi_tickets t ON t.external_id=d.glpi_id AND t.mode='real'
  WHERE f.ticket_hash=t.hash OR substr(f.ticket_hash,1,length(t.hash)+12)=t.hash||':correction:' ORDER BY f.rowid DESC`);
 const byDemand=new Map<string,any[]>();
 for(const file of files){const list=byDemand.get(file.demand_id);if(list)list.push(file);else byDemand.set(file.demand_id,[file]);}
 const listed=tickets.map(ticket=>{
  const prefix=ticket.hash+':correction:',seen=new Set<string>(),current:any[]=[];
  for(const file of byDemand.get(ticket.demand_id)||[])
   if((file.ticket_hash===ticket.hash||file.ticket_hash.startsWith(prefix))&&!seen.has(file.document_id)){seen.add(file.document_id);current.push(file);}
  const docs=(typeof ticket.documents==='string'?JSON.parse(ticket.documents):ticket.documents)||[];
  return {demand:ticket.demand_id,entries:docs.map((doc:any)=>({doc,file:current.find(f=>f.document_id===String(doc.id))}))};
 });
 const cut=(file:any)=>file.text_length>textHead&&file.text_head.split(/\r?\n/).slice(0,-1).map((s:string)=>s.trim()).filter(Boolean).length<10;
 const fullIds=[...new Set(listed.flatMap(l=>l.entries.filter((e:any)=>e.file&&cut(e.file)).map((e:any)=>e.file.id)))];
 const full=new Map(fullIds.length?(await sql.all(`SELECT id,extracted FROM processing_files WHERE id IN (${fullIds.map(()=>'?').join(',')})`,...fullIds)).map(r=>[r.id,JSON.parse(r.extracted).text||'']):[]);
 const kinds=new Map<string,string[]>();
 for(const {demand,entries} of listed)
  kinds.set(demand,[...new Set<string>(entries.map(({doc,file}:any)=>receivedDocumentKind(file?.name||doc.name,file?(full.has(file.id)?full.get(file.id):file.text_head):'')))]);
 return kinds;
}
export async function receivedDocumentTypes(did:string) {
 const {ticket}=await processingSource(did);if(!ticket)return [];
 const files=await filesFor(did,ticket.hash);
 const docs=JSON.parse(ticket.payload).documents||[];
 return [...new Set<string>(docs.map((doc:any)=>{const file=files.find(f=>f.document_id===String(doc.id));return receivedDocumentKind(file?.name||doc.name,file?JSON.parse(file.extracted).text||'':'');}))];
}
export const processingStates=["Analisando","Aguardando análise","Conferência parcial","Aguardando correção","Sem erros"];
type Issue={field:string;label:string;message:string;found?:string;expected?:string;source?:string;missingReason?:string};
/** A registered human resolution applies only while the ticket shows the same reference or finding. */
export const resolutionSignature=(field:string,value:string)=>sha256(Buffer.from(JSON.stringify([field,value])));
export const divergenceField=(field:string)=>'divergence:'+field;
export const divergenceSignature=(field:string,found:string,expected:string)=>resolutionSignature(divergenceField(field),JSON.stringify([found,expected]));
const closedInGlpi=(status:unknown)=>['5','6'].includes(String(status));
const running=new Set<string>();
const activeFiles=new Map<string,{documentId:string;targeted?:boolean;page?:number}>();
async function fingerprint(did:string) {
 const d=await sql.one("SELECT school_id,contract_id,data_version FROM demands WHERE id=?", did);
 // Independent reads fetched together; the array order is part of the fingerprint.
 const [resolutions,templates,contracts,signed,confirmed]=await Promise.all([
  sql.all('SELECT kind,field,signature,value FROM processing_resolutions WHERE demand_id=? ORDER BY kind,field', did),
  sql.all("SELECT v.id,v.status,s.template_hash,h.template_hash AS approved_hash,i.version_id AS inactive FROM template_sources s JOIN template_versions v ON v.id=s.version_id LEFT JOIN template_homologations h ON h.version_id=v.id LEFT JOIN inactive_template_versions i ON i.version_id=v.id ORDER BY v.id"),
  sql.all("SELECT id,parent_id,sequence,status FROM contracts WHERE school_id=? ORDER BY id", d?.school_id),
  sql.all("SELECT h.matrix_id,h.sequence,h.source,h.id FROM signed_history h JOIN contracts c ON c.id=h.matrix_id WHERE c.school_id=? ORDER BY h.id", d?.school_id),
  sql.all("SELECT h.matrix_id,h.sequence,h.id FROM history_confirmations h JOIN contracts c ON c.id=h.matrix_id WHERE c.school_id=? ORDER BY h.id", d?.school_id),
 ]);
 // Change this tag whenever a conferência rule changes: every open demand is then recalculated
 // by the next reading cycle, without anyone opening it.
 return sha256(Buffer.from(JSON.stringify(['v51-requested-fields-and-area-history',resolutions,d,templates,contracts,signed,confirmed])));
}
export async function processingSource(did:string) {
 const demand=await sql.one("SELECT * FROM demands WHERE id=?", did);
 const ticket=demand?.glpi_id?await sql.one("SELECT * FROM glpi_tickets WHERE external_id=? AND mode='real'", demand.glpi_id):null;
 return {demand,ticket};
}
export async function ensureProcessing(did:string) {
 const {ticket}=await processingSource(did);if(!ticket)return null;
 await sql.run("INSERT OR IGNORE INTO contract_processing(demand_id,ticket_hash,status,updated) VALUES(?,?,'Analisando',?)", did, ticket.hash, now());
 const job=await sql.one("SELECT * FROM contract_processing WHERE demand_id=?", did);
 if(job.ticket_hash!==ticket.hash)await sql.run("UPDATE contract_processing SET ticket_hash=?,status='Analisando',revision=revision+1,result='{}',updated=? WHERE demand_id=?", ticket.hash, now(), did);
 return await sql.one("SELECT * FROM contract_processing WHERE demand_id=?", did);
}
async function filesFor(did:string,hash:string) {
 const prefix=hash+":correction:";
 const files=await sql.all(`SELECT id,demand_id,document_id,ticket_hash,name,mime,extracted,problem,created,${byteSizeSql()} AS byteLength,${byteHeadSql()} AS head FROM processing_files WHERE demand_id=? AND (ticket_hash=? OR substr(ticket_hash,1,?)=?) ORDER BY rowid DESC`, did, hash, prefix.length, prefix);
 const seen=new Set<string>();
 return files.filter(f=>{
  if(seen.has(f.document_id))return false;
  seen.add(f.document_id);
  return true;
 });
}
async function extractionReviewed(file:any) {
 const hash=sha256(Buffer.from(file.extracted));
 return !!await sql.one('SELECT file_id FROM processing_field_reviews WHERE file_id=? AND extraction_hash=? LIMIT 1', file.id, hash)||!!await sql.one('SELECT file_id FROM processing_file_reviews WHERE file_id=? AND extraction_hash=?', file.id, hash);
}
async function previouslyVerifiedAttachment(did:string,documentId:string,checksum:unknown) {
 if(typeof checksum!=="string"||!(/^[a-f0-9]{40}$/i.test(checksum.trim())))return null;
 for(const {id} of await sql.all(`SELECT id FROM processing_files WHERE demand_id=? AND document_id=? AND ${byteSizeSql()}>0 ORDER BY rowid DESC`, did, documentId)){
  const previous=await sql.one("SELECT * FROM processing_files WHERE id=?", id);
  const bytes=await fileBytes(previous);
  if(previous&&matchesImportedAttachment(bytes,checksum))return {...previous,bytes};
 }
 return null;
}
/** A human check belongs to the exact bytes and extraction, not to the ticket version.
 * Copies only checks of the same extraction, keeping author and date; never creates a new one. */
async function carryReviews(fromFileId:string,did:string,documentId:string,hash:string) {
 const target=await sql.one('SELECT id,extracted FROM processing_files WHERE demand_id=? AND document_id=? AND ticket_hash=?', did, documentId, hash);
 const extractionHash=sha256(Buffer.from(target.extracted));
 const fields=(await sql.run('INSERT OR IGNORE INTO processing_field_reviews SELECT ?,field,extraction_hash,value,author,created FROM processing_field_reviews WHERE file_id=? AND extraction_hash=?', target.id, fromFileId, extractionHash)).changes;
 const whole=(await sql.run('INSERT OR IGNORE INTO processing_file_reviews SELECT ?,extraction_hash,author,created FROM processing_file_reviews WHERE file_id=? AND extraction_hash=?', target.id, fromFileId, extractionHash)).changes;
 if(fields||whole)await auditAsync(did, null, 'Conferência humana mantida na nova versão do chamado: mesmo arquivo e mesma extração. Nenhuma nova conferência foi criada.');
}
function unreadableContractIssue(doc:any,file:any,raw:any,ticketStatus:unknown):{message:string;missingReason:string}{
 if(!file){
  if(raw.documentsAvailable===false)return {missingReason:'coverage_partial',message:'O contrato foi identificado na lista do chamado, mas os anexos ainda não puderam ser consultados no GLPI.'};
  if(closedInGlpi(ticketStatus))return {missingReason:'download_pending',message:'O contrato foi identificado pelo nome, mas o chamado está encerrado no GLPI (leitura automática em segundo plano pausada). Abra a demanda e clique em Atualizar leitura para analisar este contrato.'};
  return {missingReason:'download_pending',message:'O contrato foi identificado pelo nome e aguarda download e leitura na fila automática. Clique em Atualizar leitura para priorizar.'};
 }
 let e:any={};try{e=JSON.parse(file.extracted||'{}')||{};}catch{}
 if(!file.byteLength){
  const detail=e.failureDetail?` (${e.failureDetail})`:'';
  return {missingReason:'download_failed',message:`Não foi possível baixar o anexo do contrato no GLPI${detail}. Confira a disponibilidade do arquivo no chamado.`};
 }
 const prob=String(file.problem||e.problem||'').trim();
 if(prob){
  const detail=e.failureDetail&&!prob.includes(e.failureDetail)?` (${e.failureDetail})`:'';
  return {missingReason:/sem conteúdo legível|em branco|vazio/i.test(prob)?'empty_source':'read_failed',message:`${prob}${detail}`};
 }
 if(e.decorative)return {missingReason:'empty_source',message:'O arquivo identificado como contrato contém apenas imagem sem contraste ou sem texto legível para o OCR. Envie uma cópia legível.'};
 return {missingReason:'read_failed',message:'O arquivo do contrato foi aberto, mas não retornou texto legível nem campos reconhecidos. Confira o original no GLPI ou envie uma cópia legível.'};
}
export async function buildProcessingPlan(did:string) {
 const [{demand:d,ticket},job]=await Promise.all([processingSource(did),sql.one("SELECT * FROM contract_processing WHERE demand_id=?", did)]);
 if(!d || !ticket || !job)return null;
 const raw=JSON.parse(ticket.payload),analysis=analyzeTicket(raw,{schools:[],matrices:[]});
 const overrides=JSON.parse(job.overrides),values:Record<string,string>={},origins:Record<string,string>={},issues:Issue[]=[];
 const systemLabels:Record<string,string>={template:"Modelo do contrato",templateApproval:"Validação do modelo",history:"Numeração do aditivo",organization:"Organização",files:"Documentos",generation:"Geração do contrato",consistency:"Consistência dos dados"};
 const add=(field:string,message:string,extra:Partial<Issue>={})=>issues.push({field,label:field.startsWith("review:")?"Conferência da leitura":inputLabels[field]||systemLabels[field]||field,message,...extra});
 const {fields:request,corrections:conversationCorrections,advanceRates}=conversationReferences(raw,analysis.fields),candidates:Record<string,{value:string;source:string;fileId:string}[]>={};
 const invalidIdentifiers:Record<string,{fileId:string;fileName:string;value:string;excerpt:string;page?:number;available:boolean;contractor?:boolean}[]>={};
 const filesWithQualifiedParties=new Set<string>();
 // Reads that depend only on the demand and ticket version, fetched together.
 const [resolutions,allFiles,storedRows,reviewRows,fieldReviewRows]=await Promise.all([
  sql.all('SELECT r.*,u.name AS author_name FROM processing_resolutions r LEFT JOIN users u ON u.id=r.author WHERE r.demand_id=?', did),
  filesFor(did,ticket.hash),
  sql.all('SELECT DISTINCT document_id FROM processing_files WHERE demand_id=?',did),
  sql.all('SELECT r.file_id,r.extraction_hash FROM processing_file_reviews r JOIN processing_files f ON f.id=r.file_id WHERE f.demand_id=?',did),
  sql.all('SELECT r.* FROM processing_field_reviews r JOIN processing_files f ON f.id=r.file_id WHERE f.demand_id=?',did),
 ]);
 const references:Record<string,{value:string;note:string;original:string}>={};
 for(const r of resolutions)if(r.kind==='reference'&&request[r.field]?.length&&resolutionSignature(r.field,request[r.field].join("; "))===r.signature){references[r.field]={value:r.value,note:r.note,original:request[r.field].join("; ")};request[r.field]=[r.value];}
 // All versions stay available, but a clearly replaced document no longer speaks for the demand.
 const superseded=supersededDocuments(raw.documents||[]);
 // Read up front: the comparison callbacks below are synchronous. Both tables have one row per key.
 const storedDocuments=new Set(storedRows.map(r=>r.document_id));
 const fileReviews=new Map(reviewRows.map(r=>[r.file_id,r.extraction_hash]));
 const fieldReviews=new Map(fieldReviewRows.map(r=>[r.file_id+'\u0000'+r.field,r]));
 const fieldReview=(fileId:string,field:string,hash?:string)=>{const row=fieldReviews.get(fileId+'\u0000'+field);return row&&(hash===undefined||row.extraction_hash===hash)?row:undefined;};
 const currentFiles=allFiles.filter(f=>!superseded.has(f.document_id));
 const files=currentFiles.filter(f=>{
  const reading=JSON.parse(f.extracted);
  return !f.problem&&!reading.triageOnly&&isFilledContract(reading.text||'',f.name);
 });
 const contractIds=new Set(files.map(f=>f.id));
 const currentDocuments=(raw.documents||[]).filter((doc:any)=>!superseded.has(String(doc.id)));
 const cachedByDocument=new Map(currentFiles.map(f=>[f.document_id,f]));
 const unavailable=currentDocuments.filter((doc:any)=>{
  const file=cachedByDocument.get(String(doc.id));
  return !file||file.problem||!JSON.parse(file.extracted).text?.trim();
 });
 const pendingContracts=unavailable.filter((doc:any)=>contractReadingScope(doc.name||'',cachedByDocument.get(String(doc.id))).kind==='contract');
 const unidentified=currentDocuments.filter((doc:any)=>{
  const scope=contractReadingScope(doc.name||'',cachedByDocument.get(String(doc.id)));
  return scope.kind==='unknown'&&!scope.needsWork;
 });
 const incompleteCoverage=raw.timelineCoverage==='partial'||raw.approvalCoverage==='partial'||raw.documentsAvailable===false;
 const demandType=analysis.suggestion.type||(d.type!=="A classificar"?d.type:"");
 const unusedFiles=new Set<string>();
 const expectedPartyCnpj=request.cnpj?.length===1?request.cnpj[0]:undefined;
 const expectedPartyName=request.razaoSocial?.length===1?request.razaoSocial[0]:request.nomeFantasia?.length===1?request.nomeFantasia[0]:undefined;
 const extractedByFile=new Map<string,any>();
 for(const f of files) {
  const saved=JSON.parse(f.extracted);
  const savedFields={...saved.fields};
  if(savedFields.razaoSocial)savedFields.razaoSocial=savedFields.razaoSocial.map(qualifiedCompanyName).filter(Boolean);
  const fields={...savedFields,...recoverTextFields(saved.text||'',savedFields)};
  const enriched={...saved,fields:Object.fromEntries(Object.entries(fields).map(([key,vs])=>[key,(vs as string[]).map(v=>normalizeValue(key,v)).filter(Boolean)]))};
  const partyScope=scopePartyReading(enriched,expectedPartyCnpj,expectedPartyName);
  if(partyScope.parties.length)filesWithQualifiedParties.add(f.id);
  const extracted:any={...partyScope.reading,fields:withDocumentAddress(partyScope.reading.fields||{})};
  extractedByFile.set(f.id,extracted);
  const role='document';
  const extractedHash=sha256(Buffer.from(f.extracted)),wholeReviewed=!!await sql.one('SELECT file_id FROM processing_file_reviews WHERE file_id=? AND extraction_hash=?', f.id, extractedHash);
  const scopedFields=fieldsForRole(role,extracted.fields),fieldChecks=await sql.all('SELECT field,value,extraction_hash FROM processing_field_reviews WHERE file_id=?', f.id);
  const checkedAllFields=Object.keys(scopedFields).length>0&&Object.entries(scopedFields).every(([key,values])=>values.length===1&&fieldChecks.some(check=>check.field===key&&check.extraction_hash===extractedHash&&sameRequestedValue(key,check.value,values[0])));
  if(partyScope.parties.length&&!partyScope.selected)add('review:parties:'+f.id,'Há mais de uma parte contratual possível. Identifique a empresa correspondente ao chamado; os CNPJs das partes não foram misturados.',{label:'Identificação da parte contratual',source:f.name});
  if(extracted.incomplete){
   const partialDetail=extracted.pages?` (${extracted.completedPages?.length||0}/${extracted.pages} páginas lidas${extracted.warnings?.[0]?' — '+extracted.warnings[0]:''})`:(extracted.warnings?.[0]?` (${extracted.warnings[0]})`:'');
   add('review:partial:'+f.id,`A leitura foi interrompida${partialDetail}. Os trechos já lidos foram preservados, mas é necessário conferir as páginas restantes e enviar uma cópia completa legível.`,{label:'Leitura parcial',source:f.name});
  }
  if(extracted.needsReview && !automaticReadingCheck(extracted,role,request) && !wholeReviewed && !checkedAllFields)add("review:"+f.id,readingGuidance(extracted,role),{label:"Conferência de leitura: "+f.name,source:f.name});
  // Implausible values (labels, malformed numbers) and this portal's own identity are reading artifacts, not document data.
  for(const [key,vs] of Object.entries(scopedFields))for(const value of vs){
   if(ownIdentity(key,value)&&!request[key]?.some(r=>ownIdentity(key,r)))continue;
   if(plausibleFieldValue(key,value)){
    (candidates[key]||=[]).push({value,source:f.name+(partyScope.selected&&['cnpj','razaoSocial'].includes(key)?' — parte '+partyScope.selected.role:''),fileId:f.id});
    continue;
   }
   if(!['cnpj','representanteCpf','documentoTitular'].includes(key)||!/^\d[\d.\/\s-]+\d$/.test(value)||!(key==='representanteCpf'?[11]:[11,14]).includes(value.replace(/\D/g,'').length))continue;
   const excerpt=key==='cnpj'&&partyScope.selected?partyScope.selected.excerpt:fieldExcerpt(extracted.text||'',[value]);
   const party=partyScope.selected;
   const names=request.razaoSocial||[];
   const namedContractor=names.length===1&&party&&sameRequestedValue('razaoSocial',party.name,names[0]);
   const contractor=key==='cnpj'&&!!f.byteLength&&!!party&&party.role!=='CONTRATANTE'
    &&(namedContractor||(!names.length&&/^CONTRATAD[AO]$/i.test(party.role)))
    &&(hasDigitalField(extracted,key,value)||(!extracted.incomplete&&!extracted.needsReview&&!/OCR/i.test(extracted.method||'')));
   if(excerpt)(invalidIdentifiers[key]||=[]).push({fileId:f.id,fileName:f.name,value,excerpt,page:extracted.pages===1?1:undefined,available:!!f.byteLength,contractor});
  }
 }
 const [printedCnpj,...otherCnpjs]=distinctRequestedValues('cnpj',(candidates.cnpj||[]).map(c=>c.value));
 const originalCnpj=request.cnpj?.length===1&&!references.cnpj?request.cnpj[0]:undefined;
 const provedCnpj=(candidates.cnpj||[]).some(c=>{
  if(!filesWithQualifiedParties.has(c.fileId)||!sameRequestedValue('cnpj',c.value,printedCnpj))return false;
  const reading=extractedByFile.get(c.fileId)||JSON.parse(files.find(f=>f.id===c.fileId)!.extracted);
  return hasDigitalField(reading,'cnpj',c.value)||(!reading.incomplete&&!reading.needsReview);
 });
 const normalizedCnpj=originalCnpj&&printedCnpj&&!otherCnpjs.length&&provedCnpj?corroboratedDecimalCnpj(originalCnpj,printedCnpj):undefined;
 if(normalizedCnpj)request.cnpj=[normalizedCnpj];
 for(const doc of pendingContracts){
  const reason=unreadableContractIssue(doc,cachedByDocument.get(String(doc.id)),raw,ticket.status);
  add('file:'+doc.id,reason.message,{label:'Contrato não lido',source:doc.name,missingReason:reason.missingReason});
 }
 if(!files.length&&!pendingContracts.length){
  // There is no "type to confirm" area: attachments still unidentified are named in the message of the
  // area the demand goes to, and a contract found among them later is compared automatically.
  const unknownNames=[...new Set([...unidentified,...unavailable.filter((doc:any)=>contractReadingScope(doc.name||'',cachedByDocument.get(String(doc.id))).kind==='unknown')].map((doc:any)=>doc.name))];
  const unknownNote=unknownNames.length?` Anexo(s) ainda não identificado(s): ${unknownNames.join('; ')}. Se algum for contrato, a demanda é conferida automaticamente depois da leitura.`:'';
  // A request for Kedu to draft the instrument has no filled contract yet: only an analysis request must bring one.
  if(!/an[áa]lise contratual/i.test(demandType+' '+raw.title))
   add('contractMissing',`Pedido de elaboração: os anexos são documentos de apoio, propostas, relatórios ou modelos em branco, sem contrato preenchido para conferir.${incompleteCoverage?' As aprovações do chamado não puderam ser consultadas no GLPI.':''}${unknownNote} Quando o contrato preenchido for anexado, ele é conferido automaticamente.`,{label:'Aguardando elaboração do contrato',missingReason:'awaiting_drafting'});
  else if(incompleteCoverage)
   add('contractMissing','A consulta do GLPI deixou anexos ou aprovações por verificar. Confira a conversa do chamado e o acesso da integração antes de pedir o reenvio.'+unknownNote,{label:'Consulta ao GLPI incompleta',missingReason:'coverage_partial'});
  else
   add('contractMissing','Nenhum contrato foi identificado entre os anexos do chamado. Obtenha o contrato no GLPI para conferir o preenchimento.'+unknownNote,{label:'Contrato não encontrado'});
 }
 for(const [key,vs] of Object.entries(candidates)) {
  const distinct=vs.map(x=>normalizeValue(key,x.value)).filter((v,i,a)=>a.findIndex(x=>sameRequestedValue(key,x,v))===i);
  if(distinct.length===1){values[key]=distinct[0];origins[key]=vs[0].source;}
  else if(!Object.hasOwn(overrides,key))add(key,"Foram encontrados valores diferentes nos documentos. Informe o valor correto.",{found:distinct.join("; "),source:vs.map(x=>x.source).join("; ")});
 }
 for(const [key,vs] of Object.entries(request)) {
  const distinct=distinctRequestedValues(key,vs);if(distinct.length===1){
   if(values[key] && !sameRequestedValue(key,values[key],distinct[0]) && !Object.hasOwn(overrides,key))add(key,"O documento difere do pedido. Corrija o valor para gerar o contrato.",{found:values[key],expected:distinct[0],source:"Formulário GLPI e documento anexado"});
   values[key]=distinct[0];origins[key]="Formulário e conversa do chamado GLPI";
  }
 }
 for(const key of ["cnpj","razaoSocial","nomeFantasia","endereco","remuneracao"])if(analysis.fields[key]?.value){
  const value=key==='cnpj'&&request.cnpj?.length===1?request.cnpj[0]:key==='remuneracao'&&advanceRates&&request.remuneracao?.length===1?request.remuneracao[0]:normalizeValue(key,analysis.fields[key].value);
  if(candidates[key]?.some(c=>!sameRequestedValue(key,c.value,value)) && !Object.hasOwn(overrides,key) && !issues.some(i=>i.field===key))add(key,"O valor no anexo difere do solicitado. Confira e salve o valor correto.",{found:candidates[key].map(c=>c.value).join("; "),expected:value,source:analysis.fields[key].origin});
  values[key]=value;origins[key]=analysis.fields[key].origin;
 }
 for(const [key,value]of Object.entries(JSON.parse(d.data)))if(typeof value==="string" && !values[key] && value && inputLabels[key]){values[key]=normalizeValue(key,value);origins[key]="Cadastro local da demanda";}
 for(const [key,value]of Object.entries(overrides))if(typeof value==="string"){values[key]=normalizeValue(key,value);origins[key]="Correção manual no portal";}
 for(const [key,expected] of Object.entries(request)){
  if(expected.length>1 && !issues.some(i=>i.field===key))add(key,"O próprio chamado informa valores diferentes para este campo. Confirme a referência correta antes de liberar o contrato.",{expected:expected.join("; "),source:"Formulário e observações do GLPI"});
  if(expected.length===1 && Object.hasOwn(overrides,key) && !sameRequestedValue(key,String(overrides[key]),expected[0]) && !issues.some(i=>i.field===key))add(key,"A correção manual ainda difere do solicitado no GLPI.",{found:String(overrides[key]),expected:expected[0],source:"Formulário e observações do GLPI"});
 }
 if(!values.modalidade){const named=["Garantia Completa","Garantia Conjunta","Garantia Prevista"].filter(x=>norm(htmlToText(raw.content).join(" ")+" "+raw.title).includes(norm(x)));if(named.length===1){values.modalidade=named[0];origins.modalidade="Modalidade explicitamente citada no chamado GLPI";}}
 const comparable=new Set(editableKeys.filter(key=>!["motivo","matriz"].includes(key)));
 const profileFiles=files.map(f=>{const e=extractedByFile.get(f.id)||JSON.parse(f.extracted);return {name:f.name,text:e.text||'',problem:f.problem,incomplete:!!e.incomplete,method:e.method};});
 const comparisons:any[]=Object.entries(request).filter(([key])=>files.length&&comparable.has(key)).map(([key,expected])=>{
  const located=distinctRequestedValues(key,(candidates[key]||[]).map(c=>c.value));
  // No extractor captured the field, but the exact requested value is printed in an attachment.
  const guided=!located.length&&expected.length===1?guidedConfirmation(key,expected[0],['cnpj','razaoSocial'].includes(key)?files.filter(f=>!filesWithQualifiedParties.has(f.id)):files):undefined;
  const found=guided?[guided.value]:located;
  const companies=key==='cnpj'&&expected.length>1?requestCompanyReferences(raw.content):[];
  const invalidReference=expected.length===1&&['cnpj','representanteCpf','documentoTitular'].includes(key)&&!plausibleFieldValue(key,expected[0]);
  // A manual transcription equal to the request resolves a misread field; a different one stays an error (issue above).
  const corrected=expected.length===1 && Object.hasOwn(overrides,key) && sameRequestedValue(key,String(overrides[key]),expected[0]);
  const invalidEvidence=invalidIdentifiers[key];
  if(!found.length&&!corrected&&invalidEvidence?.length){
   // This comparison records equality between the two sources, independent of cadastral validation.
   const contractorEvidence=invalidEvidence.filter(item=>item.contractor);
   if(key==='cnpj'&&expected.length===1&&expected[0].replace(/\D/g,'').length===14&&contractorEvidence.length
      &&invalidEvidence.every(item=>sameRequestedValue(key,item.value,expected[0]))){
    return {field:key,label:inputLabels[key],status:'matches',matchesReference:true,readingPending:false,
     expected:expected[0],found:contractorEvidence[0].value,evidence:contractorEvidence};
   }
   const message=invalidReference?'O identificador foi lido no documento e a referência do GLPI também é inválida. Confirme ambos com a fonte cadastral.':'O identificador foi lido no documento, mas os dígitos verificadores são inválidos. Confira a fonte cadastral antes de corrigir o preenchimento.';
   return {field:key,label:inputLabels[key]||key,status:invalidReference||expected.length>1?'ambiguous':'review',readingPending:true,
    expected:expected.join('; '),found:distinctRequestedValues(key,invalidEvidence.map(item=>item.value)).join('; '),
    evidence:invalidEvidence,message,reviewReason:{code:'invalid_identifier',message}};
  }
  const matches=expected.length===1 && found.length>0 && found.every(v=>sameRequestedValue(key,v,expected[0]));
  const tradeName=key==='razaoSocial'&&!matches&&!guided&&!!candidates[key]?.length&&candidates[key].every(c=>headerTradeName((extractedByFile.get(c.fileId)||JSON.parse(files.find(f=>f.id===c.fileId)!.extracted)).text,c.value));
  // Several values where one equals the request (branches, partners, witnesses) need a check, not a correction.
  const partlyMatches=!matches && expected.length===1 && found.length>1 && found.some(v=>sameRequestedValue(key,v,expected[0]));
  const previousVersion=!found.length&&pendingContracts.some((doc:any)=>!cachedByDocument.has(String(doc.id))&&storedDocuments.has(String(doc.id)));
  const visuallyAbsent=!found.length&&files.length>0&&files.every(f=>!f.problem&&assistedVisualAbsence(extractedByFile.get(f.id)||JSON.parse(f.extracted),key));
  const fieldEvidence={reason:'not_located',message:'O campo não foi localizado no contrato. Confira o trecho correspondente no original.',expectedDocument:'Contrato',sourceDocuments:files.map(f=>f.name)};
  // Shows where the value is printed so a person can check it; the field stays pending.
  const valueSource=!found.length&&expected.length===1?attachmentWithValue(key,expected[0],files):undefined;
  const evidence=previousVersion?{...fieldEvidence,reason:'awaiting_version',message:'O chamado foi atualizado. A leitura disponível pertence à versão anterior; aguardando obter e conferir os anexos da versão atual.'}:visuallyAbsent?{...fieldEvidence,reason:'not_printed',message:'Os anexos foram conferidos visualmente e este dado não está informado. Solicite um documento que o contenha ou esclareça o pedido; não se trata de falha de OCR.'}:valueSource?{...fieldEvidence,reason:'value_unassociated',message:`O valor aparece em "${valueSource}", mas sem rótulo ou entidade que o ligue a este campo. Confira o trecho no original; isto não confirma o campo.`}:fieldEvidence;
  const notApplicable=!found.length&&!corrected&&expected.length===1?notApplicableReason(/descredenciamento/i.test(demandType)?'':demandType,key,profileFiles):'';
  if(!found.length && !corrected && !notApplicable && !issues.some(i=>i.field===key))add(key,evidence.message,{expected:expected.join("; "),source:evidence.expectedDocument});
  // Certainty concerns the extracted value, independently of agreement with GLPI.
  // One proven mismatch must not become inconclusive because a duplicate OCR
  // attachment supplies the same value but has lower reading confidence.
  const trustedReading=found.length===1&&(candidates[key]||[]).some(c=>{
   const file=files.find(f=>f.id===c.fileId)!;
   const reading=extractedByFile.get(c.fileId)||JSON.parse(file.extracted),role='document';
   if(file.problem)return false;
   if(issues.some(i=>i.field.startsWith('review:')&&i.field.endsWith(c.fileId)&&!['review:'+c.fileId,'review:partial:'+c.fileId].includes(i.field)))return false;
   if(hasDigitalField(reading,key,c.value))return true;
   if(reading.incomplete)return false;
   const hash=sha256(Buffer.from(file.extracted));
   if(fileReviews.get(file.id)===hash)return true;
   const checked=fieldReview(file.id,key,hash);
   if(checked&&sameRequestedValue(key,checked.value,c.value))return true;
   return !reading.needsReview||automaticReadingCheck({...reading,fields:{[key]:[c.value]}},role,request);
  });
  const referenceTradeName=key==='razaoSocial'&&(candidates[key]||[]).some(c=>{
   const reading=extractedByFile.get(c.fileId)||JSON.parse(files.find(f=>f.id===c.fileId)!.extracted);
   return referenceTradeNameNeedsReview(key,found,expected,request.cnpj||[],{...reading.fields,...recoverTextFields(reading.text||'',{})});
  });
  const needsFieldReview=(referenceTradeName||legalFormReferenceNeedsReview(key,found,expected)||tradeName||!!guided&&!guided.associated||qualifiedNameNeedsReview(key,found,expected)||!trustedReading&&(candidates[key]||[]).some(c=>{
   const pending=issues.filter(i=>i.field.startsWith('review:')&&i.field.endsWith(c.fileId));
   if(!pending.length)return false;
   // Structural, partial and legal reviews remain independent of OCR certainty.
   if(pending.some(i=>i.field!=='review:'+c.fileId))return true;
   const file=files.find(f=>f.id===c.fileId)!;
   const reading=extractedByFile.get(c.fileId)||JSON.parse(file.extracted),role='document';
   const confirmed=fieldReview(file.id,key,sha256(Buffer.from(file.extracted)));
   if(!reading.incomplete&&confirmed&&sameRequestedValue(key,confirmed.value,c.value))return false;
   return !automaticReadingCheck({...reading,fields:{[key]:[c.value]}},role,request);
  }));
  const bankHolderContext=key==='razaoSocial'&&guided&&!guided.associated?distinctRequestedValues('titularConta',(candidates.titularConta||[]).map(c=>c.value)):[];
  const conflictingRates=['remuneracao','garantia','repasse','repasseSegundo','cashback'].includes(key)&&expected.length>1&&expected.every(value=>plausibleFieldValue(key,value))&&trustedReading&&!needsFieldReview;
  const reviewReason=conflictingRates?{code:'reference_conflict',message:'O GLPI informa taxas diferentes para este campo. Confirme e registre qual taxa vale para a demanda antes de solicitar alteração do documento.'}:bankHolderContext.length===1?{code:'commercial_name_bank_holder',message:'O nome aparece no comunicado, mas não como razão social. O titular bancário declarado é '+bankHolderContext[0]+'. Confirme o vínculo entre o nome comercial e a pessoa jurídica; não foi presumida equivalência.'}:needsFieldReview||partlyMatches?comparisonReviewReason({referenceTradeName,referenceNameTypo:legalFormReferenceNeedsReview(key,found,expected),tradeName,guided:!!guided&&!guided.associated,qualifiedName:qualifiedNameNeedsReview(key,found,expected),conflictingValues:partlyMatches,readings:(candidates[key]||[]).map(c=>extractedByFile.get(c.fileId)||JSON.parse(files.find(f=>f.id===c.fileId)!.extracted)),field:key}):undefined;
  if(reviewReason&&['reference_trade_name','reference_name_typo'].includes(reviewReason.code))for(const issue of issues.filter(i=>i.field===key))issue.message=reviewReason.message;
  // A figure read by OCR whose own spelled-out value, or a single commonly confused digit, points to the request.
  const sources=(candidates[key]||[]).map(c=>({c,reading:extractedByFile.get(c.fileId)||JSON.parse(files.find(f=>f.id===c.fileId)!.extracted)}));
  const doubt=!reviewReason&&!matches&&!corrected&&!needsFieldReview&&!partlyMatches&&expected.length===1&&found.length===1
   ?readingDoubt(key,found[0],expected[0],sources.map(x=>x.reading.text||''),sources.some(x=>/OCR/i.test(x.reading.method||''))&&!sources.some(x=>hasDigitalField(x.reading,key,x.c.value))):undefined;
  if(doubt)for(const issue of issues.filter(i=>i.field===key))issue.message=doubt.message;
  const correction=conversationCorrections[key];
  return {field:key,referenceNormalization:key==='cnpj'&&normalizedCnpj?originalCnpj:undefined,advanceRateContext:key==='remuneracao'&&expected.length===1&&expected[0]===advanceRates?.advance?advanceRates:undefined,referenceResolution:references[key],referenceCorrection:correction&&expected.length===1&&sameRequestedValue(key,expected[0],correction.value)?correction:undefined,reviewReason:reviewReason||(doubt&&{code:doubt.code,message:doubt.message}),matchesReference:matches,partlyMatches,expectedEntities:companies,message:companies.length>1?'O chamado menciona mais de uma empresa. Os CNPJs foram separados; confira cada arquivo com a empresa correspondente. O CNPJ do titular bancário não comprova, sozinho, o CNPJ do contrato social.':invalidReference?'O documento informado no GLPI tem quantidade de dígitos ou dígitos verificadores inválidos. Confirme a referência no chamado antes de solicitar alteração do arquivo.':undefined,missingReason:!found.length?evidence.reason:undefined,expectedDocument:evidence.expectedDocument,sourceDocuments:evidence.sourceDocuments,readingPending:needsFieldReview||partlyMatches||!!doubt?.review,label:key==='cnpj'&&expected.length===1&&expected[0].replace(/\D/g,'').length===11?'CPF':analysis.suggestion.type==="Parcelamento" && key==="valor"?"Valor parcelado":analysis.suggestion.type==="Parcelamento" && key==="parcelas"?"Quantidade de parcelas":inputLabels[key]||key,expected:expected.join("; "),found:found.join("; "),source:guided?guided.source+(guided.associated?" (valor localizado junto ao rótulo do campo)":" (valor do chamado localizado no texto)"):[...new Set((candidates[key]||[]).map(c=>c.source))].join("; "),used:values[key]||"",note:notApplicable||undefined,status:invalidReference||expected.length>1?"ambiguous":corrected?"corrected":notApplicable?"not_applicable":!found.length?"missing":needsFieldReview||partlyMatches||doubt?.review?"review":!matches?"different":"matches"};
 });
 // Confidence belongs to the requested fields. Unused OCR fields must not keep an otherwise
 // completely read file pending after every requested field it supplies has independent proof.
 for(const f of files){
  const index=issues.findIndex(i=>i.field==='review:'+f.id);if(index<0||f.problem)continue;
  const e=extractedByFile.get(f.id)||JSON.parse(f.extracted);
  // Unrequested calculations do not invalidate an identity read from literal
  // workbook cells. Financial/calculated fields never qualify for this rule.
  const literalRelated=comparisons.filter(c=>request[c.field]?.length&&(candidates[c.field]||[]).some(v=>v.fileId===f.id));
  if(/^XLSX(?: com OCR)?$/.test(e.method||'')&&e.literalIdentityFields&&literalRelated.length&&literalRelated.every(c=>c.status==='matches'&&!c.readingPending&&['cnpj','razaoSocial','nomeFantasia'].includes(c.field)&&e.literalIdentityFields[c.field]?.length===1)){
   issues.splice(index,1);continue;
  }
  if(e.incomplete||(e.formulaCount||0)>0)continue;
  if(issues.some(i=>i.field.startsWith('review:')&&i.field.endsWith(f.id)&&i.field!=='review:'+f.id))continue;
  const related=comparisons.filter(c=>request[c.field]?.length&&(candidates[c.field]||[]).some(v=>v.fileId===f.id));
  // A completely read file that supplies no requested field does not block the demand once every
  // requested field is resolved by another source. It stays visible as not used.
  if(!related.length&&comparisons.length&&comparisons.every(c=>['matches','corrected','accepted','not_applicable'].includes(c.status)&&!c.readingPending)){issues.splice(index,1);unusedFiles.add(f.id);continue;}
  if(!Number.isInteger(e.pages)||e.pages<1)continue;
  if(!related.length&&unusedPersonalId(e,f.name,request,comparisons)){issues.splice(index,1);continue;}
  if(related.length&&related.every(c=>c.status==='matches'&&!c.readingPending))issues.splice(index,1);
 }
 const cession=files.length?cessionClauseCheck(demandType,profileFiles):null;
 if(cession){comparisons.push(cession);if(cession.status!=='matches')add('clausulaCessao',cession.message,{label:cession.label});}
 // A bank receipt is not a contract, but bank data printed in it that differs from the GLPI reference needs correction.
 for(const f of currentFiles){
  if(contractIds.has(f.id)||f.problem)continue;
  const reading=JSON.parse(f.extracted);
  if(reading.triageOnly||reading.awaitingOcr||!isBankDocument(f.name,reading.text||''))continue;
  for(const key of ['banco','agencia','conta','titularConta','documentoTitular','pix']){
   const expected=request[key];
   if(expected?.length!==1||Object.hasOwn(overrides,key))continue;
   const found=distinctRequestedValues(key,(reading.fields?.[key]||[]).map((v:string)=>normalizeValue(key,v)).filter((v:string)=>v&&plausibleFieldValue(key,v)));
   if(!found.length||found.some(v=>sameRequestedValue(key,v,expected[0])))continue;
   // A photo of a banking screen can split one number over two lines: that is a reading doubt, not a divergence.
   const doubt=found.length===1?readingDoubt(key,found[0],expected[0],[reading.text||''],/OCR/i.test(reading.method||'')&&!hasDigitalField(reading,key,found[0])):undefined;
   const message=doubt?.review?doubt.message:`O comprovante bancário "${f.name}" informa ${found.join('; ')}, diferente do GLPI (${expected[0]}). Confira e corrija o dado bancário.`;
   const detail={found:found.join('; '),expected:expected[0],source:f.name};
   const status=doubt?.review?{status:'review',readingPending:true,reviewReason:{code:doubt.code,message:doubt.message}}:{status:'different',readingPending:false};
   const comparison=comparisons.find(c=>c.field===key);
   if(comparison?.status==='different')continue;
   if(comparison)Object.assign(comparison,detail,status,{matchesReference:false,missingReason:undefined,message});
   else comparisons.push({field:key,label:inputLabels[key]||key,...status,matchesReference:false,...detail,message});
   const issue=issues.find(i=>i.field===key);
   if(issue)Object.assign(issue,detail,{message});else add(key,message,detail);
  }
 }
 // A divergence accepted with a justification counts as resolved while both values stay the same.
 for(const c of comparisons.filter((c:any)=>c.status==='different')){
  const accepted=resolutions.find((r:any)=>r.kind==='validation'&&r.field===divergenceField(c.field)&&r.signature===divergenceSignature(c.field,c.found,c.expected));
  if(!accepted)continue;
  Object.assign(c,{status:'accepted',readingPending:false,acceptance:{note:accepted.note,author:accepted.author_name||accepted.author,created:accepted.created}});
  for(let i=issues.length-1;i>=0;i--)if(issues[i].field===c.field)issues.splice(i,1);
 }
 const validationFindings=validateReadings(files.filter(f=>!f.problem).map(f=>{const scoped=extractedByFile.get(f.id)||scopePartyReading(JSON.parse(f.extracted),expectedPartyCnpj,expectedPartyName).reading;const fields=scoped.fields as Record<string,string[]>;return {name:f.name,fields:Object.fromEntries(Object.entries(fields).map(([key,vs])=>[key,vs.filter(v=>plausibleFieldValue(key,v))]))};}));
 for(const finding of validationFindings){
  const resolved=resolutions.find(r=>r.kind==='validation'&&r.field===finding.field&&r.signature===resolutionSignature(finding.field,finding.found));
  if(resolved){finding.resolution={note:resolved.note,created:resolved.created};continue;}
  add('review:validation:'+finding.field,finding.message,{label:inputLabels[finding.field]||finding.field,found:finding.found,source:finding.source});
 }
 if(!values.duracaoMeses && values.inicio && values.fim)try{const months=wholeMonths(values.inicio,values.fim);if(months!==null && months>0){values.duracaoMeses=String(months);origins.duracaoMeses="Calculado a partir das datas exatas de início e fim";}}catch{}
 if(!d.school_id)add("organization","Identifique e cadastre a organização correta antes de gerar o contrato.");
 else {const school=await sql.one("SELECT cnpj FROM schools WHERE id=?", d.school_id);if(values.cnpj && school?.cnpj.replace(/\D/g,"")!==values.cnpj.replace(/\D/g,""))add("cnpj","O CNPJ informado difere da organização vinculada à demanda.",{found:values.cnpj,expected:school?.cnpj});}
 const documentTypes=[...new Set(files.filter(f=>!f.problem).map(f=>identifyDocumentHeading(f.name,JSON.parse(f.extracted).text||"").type).filter(t=>t && t!=="Contrato"))];
 const type=analysis.suggestion.type || (d.type!=="A classificar"?d.type:documentTypes.length===1?documentTypes[0]:"");
 const subtype=analysis.suggestion.subtype || (await details(d)).subtype || "";
 const templates=(await listOfficial()).filter(t=>!t.inactive && (!type || t.document_type===type) && (t.document_type!=="Aditivo" || !subtype || t.subtype===subtype));
 const eligible=templates.filter(t=>!t.modality || t.modality===values.modalidade);
 let template=job.template_id?templates.find(t=>t.version_id===job.template_id):eligible.length===1?eligible[0]:null;
 if(template?.modality && values.modalidade && template.modality!==values.modalidade)template=null;
 // Without an official model the result is the list of errors; asking for a model or its fields is noise.
 if(!template&&templates.length)add("template","Confirme o modelo correspondente ao pedido.");
 let version:any=null,sequence:number|null=null,matrix:any=null;
 const actualType=template?.document_type || type,actualSubtype=template?.subtype || subtype;
 if(template) {
  if(template.modality && !values.modalidade)values.modalidade=template.modality;
  version=await sql.one("SELECT * FROM template_versions WHERE id=?", template.version_id);
  if(!version || !await homologated(version))add("templateApproval","O modelo correspondente aguarda homologação jurídica em Modelos.");
  if(actualType==="Aditivo") {
   const own=await sql.one("SELECT * FROM contracts WHERE id=?", d.contract_id);
   const matrices=await sql.all("SELECT * FROM contract_registry WHERE school_id=? AND instrument_kind='Matriz' AND status='Assinado'", d.school_id);
   matrix=matrices.find(m=>m.id===(values.matriz || own?.parent_id)) || (matrices.length===1?matrices[0]:null);
   if(!matrix)add("matriz","Vincule o contrato matriz assinado desta organização.");
   else {
    values.matriz=matrix.id;
    const history=await sql.one("SELECT * FROM signed_history WHERE matrix_id=? ORDER BY sequence DESC LIMIT 1", matrix.id);
    if(own?.parent_id===matrix.id)sequence=own.sequence;
    else if(!history)add("history","Confirme o último aditivo efetivamente assinado no cadastro da matriz.");
    else if(history.source==="Registro local" && !await sql.one("SELECT id FROM history_confirmations WHERE matrix_id=? AND sequence=?", matrix.id, history.sequence))add("history","Reconﬁrme o último aditivo assinado no Clicksign/Clint.");
    else {sequence=history.sequence+1;if(await sql.one("SELECT id FROM contracts WHERE parent_id=? AND sequence=?", matrix.id, sequence))add("history","O próximo número já está reservado por outra demanda. Confira a numeração antes de continuar.");}
    if(!values.dataAssinaturaMatriz){const external=await sql.one("SELECT signature_date FROM external_contract_files WHERE contract_id=?", matrix.id);if(external)values.dataAssinaturaMatriz=external.signature_date;}
   }
  }
 }
 const required=officialRequired(actualType,actualSubtype,values.modalidade||"");
 for(const key of required)if(!values[key]?.trim() && !issues.some(i=>i.field===key))add(key,"Preencha este dado: ele não foi identificado no chamado ou nos documentos.");
 for(const [key,message]of Object.entries(validateData(values)))if(!issues.some(i=>i.field===key))add(key,message,{found:values[key]});
 if(values.cnpj && !plausibleFieldValue('cnpj',values.cnpj))add("cnpj","CPF/CNPJ com dígitos verificadores inválidos. Confira o documento cadastral.",{found:values.cnpj});
 for(const message of officialProblems(actualType,actualSubtype,values))add("consistency",message);
 let generated:Buffer|null=null,derived:Record<string,string>={};
 if(version)try {
  derived=deriveOfficial(values,{sequence,notice:""});
  derived.pix=derived.pix||"";
  for(const slot of JSON.parse((await sourceOf(version.id)).slots))if(!["avisoHomologacao","pix"].includes(slot) && !derived[slot]?.trim()){
   const key=derivedFrom[slot]||slot;
   if(!issues.some(i=>i.field===key) && key!=="aditivo")add(key,"Falta informação necessária para preencher o modelo.");
  }
  if(!issues.length){generated=generate(Buffer.from(version.bytes),derived);if(review(generated,derived,Buffer.from(version.bytes)).status!=="conforme"){generated=null;add("generation","A conferência do documento gerado encontrou divergência. O download permanece bloqueado.");}}
 }catch{add("generation","Não foi possível preencher o modelo com estes dados. Confira o modelo e os campos indicados.");}
 const typeIdentification={type:actualType||"Não identificado",source:analysis.suggestion.type?analysis.suggestion.basis:d.type!=="A classificar"?"Classificação registrada na demanda":documentTypes.length===1?"Título no início do documento ou nome do arquivo":"Conferência manual necessária",ticketTitle:raw.title,correction:templates.length?"Modelo oficial":"Lista de erros (tipo sem modelo oficial)"};
 // What the GLPI asks for, shown in the comparison table even before a filled contract exists.
 const requested=Object.entries(request).filter(([key,expected])=>comparable.has(key)&&expected.length).map(([key,expected])=>({field:key,label:inputLabels[key]||key,expected:expected.join('; ')}));
 return {requested,demand:d,ticket,job,values,origins,issues:issues.map(issue=>({...issue,pendingReason:pendingReason({...issue,...comparisons.find(c=>c.field===issue.field)})})),comparisons,validationFindings,typeIdentification,template,templates,version,sequence,matrix,derived,generated,type:actualType,subtype:actualSubtype,
  files:allFiles.map(f=>{const saved=JSON.parse(f.extracted);const savedFields={...saved.fields};if(savedFields.razaoSocial)savedFields.razaoSocial=savedFields.razaoSocial.map(qualifiedCompanyName).filter(Boolean);const fields={...savedFields,...recoverTextFields(saved.text||'',savedFields)};const enriched={...saved,fields:Object.fromEntries(Object.entries(fields).map(([key,vs])=>[key,(vs as string[]).map(v=>normalizeValue(key,v)).filter(Boolean)]))};const scope=scopePartyReading(enriched,expectedPartyCnpj,expectedPartyName),e=extractedByFile.get(f.id)||scope.reading;return {
   parties:scope.parties,selectedParty:scope.selected,vision:e.vision,
   guidance:readingGuidance(e,attachmentRole(f.name,e.text||'')),changes:proposedChanges(e.text||''),
   fieldReviews:contractIds.has(f.id)?[...new Set([...Object.keys(candidates).filter(key=>candidates[key].some(c=>c.fileId===f.id)),...Object.keys(request).filter(key=>missingFieldEvidence(key,[{name:f.name,text:e.text||''}]).reason!=='not_sent')])].map(key=>{
    const vs=candidates[key]||[];
    const values=distinctRequestedValues(key,vs.filter(c=>c.fileId===f.id).map(c=>c.value));
    const check=fieldReview(f.id,key);
    const evidence=values.length===1?(digitalFieldOrigin(e,key,values[0])||identityEvidence(e,key,values[0],attachmentRole(f.name,e.text||''))):null;
    const assisted=values.length===1?assistedVisualField(e,key,values[0],attachmentRole(f.name,e.text||'')):null;
    const observations=values.map(value=>{
     const origin=assistedVisualField(e,key,value,attachmentRole(f.name,e.text||''))||digitalFieldOrigin(e,key,value)||e.fieldOrigins?.[key]?.find((o:any)=>sameRequestedValue(key,o.value,value));
     return {value,page:origin?.page||(e.pages===1?1:undefined),excerpt:origin?.excerpt||fieldExcerpt(e.text||'',[value])||(scope.selected&&['cnpj','razaoSocial'].includes(key)?scope.selected.excerpt:'')||labelledLocationExcerpt(e.text||'',key,value)};
    });
    return {key,label:inputLabels[key]||key,values,observations,expected:request[key]||[],assistedVisualReview:!!assisted,page:assisted?.page||evidence?.page||e.fieldOrigins?.[key]?.[0]?.page||(e.pages===1?1:undefined),excerpt:assisted?.excerpt||evidence?.excerpt||(scope.selected&&['cnpj','razaoSocial'].includes(key)?scope.selected.excerpt:fieldExcerpt(e.text||'',values)),confirmed:!!check&&check.extraction_hash===sha256(Buffer.from(f.extracted))&&values.length===1&&sameRequestedValue(key,check.value,values[0])};
   }):[],
   contractForComparison:contractIds.has(f.id),readingScope:contractReadingScope(f.name,f).kind,available:!!f.byteLength,regionReading:readerAvailable(),incomplete:!!e.incomplete,role:attachmentRole(f.name,e.text||''),notUsed:unusedFiles.has(f.id),supersededBy:superseded.get(f.document_id),
   readingValidatedAutomatically:automaticReadingCheck(e,attachmentRole(f.name,e.text||''),request),
   reviewFields:Object.entries(candidates).filter(([,vs])=>vs.some(c=>c.fileId===f.id)).map(([key])=>inputLabels[key]||key),
   warnings:e.warnings||[],ocrEngine:e.ocrEngine,preprocessing:e.preprocessing||[],formulaCount:e.formulaCount||0,calculatedFields:Object.entries(e.calculatedFields||{}).map(([key,values])=>({key,label:inputLabels[key]||key,values})),identification:identifyDocumentHeading(f.name,e.text||""),id:f.id,document_id:f.document_id,name:f.name,mime:f.mime,problem:f.problem,method:e.method,confidence:e.confidence,pages:e.pages,
   needsReview:!!e.needsReview && !e.incomplete && issues.some(i=>i.field==='review:'+f.id||i.field==='review:formulas:'+f.id),corrected:f.ticket_hash.includes(":correction:"),text:e.text?.slice(0,500000)||""};})};
}
export async function saveProcessingResult(did:string) {
 const plan=await buildProcessingPlan(did);if(!plan)return null;
 const previous=await sql.one('SELECT result FROM contract_processing WHERE demand_id=?', did);
 const result={requested:plan.requested,values:plan.values,origins:plan.origins,issues:plan.issues,comparisons:plan.comparisons.map(row=>({...row,evidence:row.evidence||comparisonSources(row,plan.files)})),validationFindings:plan.validationFindings,typeIdentification:plan.typeIdentification,template:plan.template,templates:plan.templates,files:plan.files,type:plan.type,subtype:plan.subtype,fingerprint:await fingerprint(did)};
 const hasReadableDocument=plan.files.some(file=>file.contractForComparison&&file.available);
 const status=processingStatus(plan.issues,plan.comparisons,hasReadableDocument);
 // The area is kept with the result; a change is audited so reports can show movements per period.
 const area=demandArea({status,issues:plan.issues},JSON.parse(plan.ticket.payload));
 let before='';try{before=JSON.parse(previous?.result||'{}').area||'';}catch{}
 await sql.run("UPDATE contract_processing SET status=?,result=?,updated=? WHERE demand_id=?", status, JSON.stringify({...result,area}), now(), did);
 if(before&&before!==area)await auditAsync(did,null,`Conferência: ${before} → ${area}`);
 return {status,revision:plan.job.revision,ticket_hash:plan.ticket.hash,...result};
}
export async function processContract(did:string,userId:string|null=null,download:(ticketId:string,documentId:string,signal:AbortSignal)=>Promise<{bytes:Buffer;name:string;mime:string}>=downloadGlpiAttachment,force=false,targetedOnly=false,deadline=Infinity) {
 if(running.has(did))return;const job=await ensureProcessing(did);if(!job)return;
 running.add(did);await sql.run("UPDATE contract_processing SET status='Analisando',updated=? WHERE demand_id=?", now(), did);
 const {demand,ticket}=await processingSource(did);
 const readingOptions={deadline,pageStore:sql.dialect==='postgres'?sql:undefined};
 try {
  const raw=JSON.parse(ticket.payload);
  const initialFiles=new Map((await filesFor(did,ticket.hash)).map(file=>[file.document_id,file]));
  const documents=targetedOnly?[]:currentReadingDocuments(raw).map(doc=>{
   const file=initialFiles.get(String(doc.id));
   return {doc,scope:contractReadingScope(doc.name||'',file)};
  }).filter(({doc})=>!deferredOcrWorker||cachedForOcr(initialFiles.get(String(doc.id))))
   .sort((a,b)=>Number(b.scope.kind==='contract')-Number(a.scope.kind==='contract'));
  for(const {doc,scope} of documents) {
   if(Date.now()>=deadline||await recoveryPaused()&&!force&&userId===null)break;
   const cached=(await filesFor(did,ticket.hash)).find(f=>f.document_id===String(doc.id));
   if(scope.kind==='support'&&!scope.needsWork||cached?.byteLength&&!force&&await extractionReviewed(cached))continue;
   if(!force&&(!scope.needsWork||awaitsOcr(cached)))continue;
   activeFiles.set(did,{documentId:String(doc.id)});
   let file:any,extracted:any,reusedFrom:string|undefined;
   try {
    const provenPrevious=!cached?.byteLength?await previouslyVerifiedAttachment(did,String(doc.id),doc.sha1):null;
    if(cached?.byteLength)file={name:cached.name,mime:cached.mime,bytes:await fileBytes(await sql.one('SELECT * FROM processing_files WHERE id=?', cached.id))};
    else if(provenPrevious)file={name:doc.name||provenPrevious.name,mime:provenPrevious.mime,bytes:Buffer.from(provenPrevious.bytes)};
    else for(let attempt=0;attempt<3;attempt++){
     const remaining=deadline-Date.now();
     if(remaining<=0)break;
     try {file=await download(demand.glpi_id,String(doc.id),AbortSignal.timeout(Math.min(30000,remaining)));if(!file.bytes.length)throw Error('Arquivo vazio.');break;}
     catch(error:any){
      if(Date.now()>=deadline)break;
      if(attempt===2 || [400,401,403,404].includes(error?.status))throw error;
      await new Promise(resolve=>setTimeout(resolve,Math.min(750*2**attempt,Math.max(0,deadline-Date.now()))));
     }
    }
    if(!file)break;
    const previous=provenPrevious||(!cached?.byteLength?await sql.one(`SELECT * FROM processing_files WHERE demand_id=? AND document_id=? AND ${byteSizeSql()}>0 ORDER BY rowid DESC LIMIT 1`, did, String(doc.id)):null);
    // A changed ticket can retain the exact same attachment. Verify current GLPI bytes before reuse.
    if(previous&&!previous.problem&&storedHash(previous)===sha256(file.bytes)&&!contractReadingScope(file.name,{byteLength:file.bytes.length,extracted:previous.extracted}).needsWork){extracted=JSON.parse(previous.extracted);reusedFrom=previous.id;}
    // An inconclusive identification is followed by a full reading, never by the same identification again.
    else if(scope.kind==='contract'||(!!cached&&JSON.parse(cached.extracted).triageOnly===true))extracted={...await readProcessingFile(file.bytes,file.name,undefined,false,readingOptions),contractIdentified:!!cached&&JSON.parse(cached.extracted).contractIdentified===true};
    else {
     const detected=readingFilename(file.bytes,file.name);
     const preview=/\.(pdf|png|jpe?g|webp|tiff?|bmp|gif)$/i.test(detected)
      ?await readProcessingFile(file.bytes,detected,{page:1,x:0,y:0,width:1,height:1,rotation:0,identification:true},false,readingOptions)
      :/\.docx$/i.test(detected)&&file.bytes.length<=20*1024*1024?extractProcessingFile(file.bytes,detected):/\.(doc|odt|txt)$/i.test(detected)?await readProcessingFile(file.bytes,detected,undefined,true,readingOptions):null;
     const likelyContractOnCover=preview&&!preview.problem&&/\.pdf$/i.test(detected)&&!isSupportDocument(file.name,preview.text||'')&&/\b(?:contratante|contratad[ao]|cedente|cessionaria|clausula|termo aditivo|aditamento|distrato|rescisao|confissao de divida|prestacao de servicos|clicksign|docusign|zapsign|d4sign|autentique)\b/i.test(preview.text||'');
     const fullRead=preview&&!preview.problem&&(isFilledContract(preview.text||'',file.name)||likelyContractOnCover)?await readProcessingFile(file.bytes,file.name,undefined,false,readingOptions):null;
     extracted=fullRead&&isFilledContract(fullRead.text||'',file.name)
      ?{...fullRead,contractIdentified:true}
      :{...(fullRead||preview),version:readerVersion,text:(fullRead||preview)?.text?.slice(0,10000)||'',fields:{},problem:(fullRead||preview)?.problem||'',method:'Identificação inicial',needsReview:false,triageOnly:true};
    }
   }
   catch(error){file??={name:doc.name,mime:doc.mime||"application/octet-stream",bytes:Buffer.alloc(0)};extracted={version:readerVersion,text:"",fields:{},problem:file.bytes.length?"O original está disponível, mas a leitura falhou. Confira o arquivo ou envie uma cópia acessível.":"Não foi possível baixar o anexo após as tentativas de recuperação. Confira a disponibilidade no GLPI.",failureDetail:failureDetail(error),method:'inconclusiva',needsReview:false};}
   if((await sql.one("SELECT hash FROM glpi_tickets WHERE external_id=?", demand.glpi_id))?.hash!==ticket.hash)return;
   // A crashed or unavailable reader never replaces a reading that already worked; it is retried later.
   if(preservePreviousReading(cached?.extracted,extracted)){activeFiles.delete(did);continue;}
   if(deferredOcrWorker&&(extracted.transient||extracted.incomplete))
    extracted.awaitingOcr=true;
   if(cached?.byteLength)await sql.run("UPDATE processing_files SET extracted=?,problem=? WHERE id=?", JSON.stringify(extracted), extracted.problem, cached.id);
   else {
    await sql.transaction(async () => {
     await saveProcessingFile({id:id(),demand_id:did,document_id:String(doc.id),ticket_hash:ticket.hash,name:file.name,mime:file.mime,bytes:file.bytes,extracted:JSON.stringify(extracted),problem:extracted.problem,created:now()},true);
     if(reusedFrom)await carryReviews(reusedFrom,did,String(doc.id),ticket.hash);
    });
   }
   await sql.run("UPDATE contract_processing SET revision=revision+1 WHERE demand_id=?", did);await invalidate(did);
   activeFiles.delete(did);
  }
  // Reuse healthy originals and read at most two known pages, one at a time.
  const pendingPlan=await buildProcessingPlan(did);
  let targetedPages=0;
  for(const entry of deferredOcrWorker?[]:await targetedRecovery(did,ticket.hash,pendingPlan?.comparisons)){
   for(const target of entry.targets){
    if(Date.now()>=deadline||targetedPages>=2||await recoveryPaused()&&!force&&userId===null)break;
    targetedPages++;
    activeFiles.set(did,{documentId:entry.file.document_id,targeted:true,page:target.page});
    const current=await sql.one('SELECT * FROM processing_files WHERE id=?', entry.file.id);
    const before=JSON.parse(current.extracted);
    const bytes=await fileBytes(current);
    const complementary=/\.pdf$/i.test(entry.file.name)&&process.env.DOCUMENT_DOCLING_ENABLED==='true'?await readDoclingPage(bytes,target.page,{deadline}):null;
    const useful=complementary?.ok&&target.fields.some(key=>complementary.fields[key]?.some(value=>plausibleFieldValue(key,value)));
    const reread=useful?{...complementary,problem:'',needsReview:true}:await readProcessingFile(bytes,entry.file.name,{page:target.page,x:0,y:0,width:1,height:1,rotation:0},false,readingOptions);
    if((await sql.one('SELECT hash FROM glpi_tickets WHERE external_id=?', demand.glpi_id))?.hash!==ticket.hash)return;
    // A confirmation or manual update made while OCR was running wins.
    if((await sql.one('SELECT extracted FROM processing_files WHERE id=?', entry.file.id))?.extracted!==current.extracted)continue;
    if(await sql.one('SELECT file_id FROM processing_file_reviews WHERE file_id=? AND extraction_hash=?', entry.file.id, sha256(Buffer.from(current.extracted))))continue;
    const merged=JSON.stringify(mergeTargetedReading(before,reread,target));
    await sql.run('UPDATE processing_files SET extracted=? WHERE id=?', merged, entry.file.id);
    // Confirmed fields were excluded from targets and their original values/evidence remain intact.
    await sql.run('UPDATE processing_field_reviews SET extraction_hash=? WHERE file_id=? AND extraction_hash=?', sha256(Buffer.from(merged)), entry.file.id, sha256(Buffer.from(current.extracted)));
    await sql.run('UPDATE contract_processing SET revision=revision+1 WHERE demand_id=?', did);await invalidate(did);
    activeFiles.delete(did);
   }
   if(targetedPages>=2)break;
  }
  // Auxiliary extraction never modifies local fields or human reviews. Explicit recheck runs
  // at most two documents, with persistent deduplication and no automatic retry storm.
  if(visionConfig().ready&&userId!==null){
   const plan=await buildProcessingPlan(did),keys=(plan?.comparisons||[]).filter(c=>['missing','review'].includes(c.status)).map(c=>c.field);
   let calls=0;
   for(const cached of await filesFor(did,ticket.hash)){
    if(calls>=2||!keys.length)break;if(!cached.byteLength||!plan?.files.some(f=>f.id===cached.id&&f.contractForComparison)||await extractionReviewed(cached))continue;
    const reading=JSON.parse(cached.extracted),bytes=await fileBytes(await sql.one('SELECT * FROM processing_files WHERE id=?', cached.id));
    if(!shouldReadVision(reading.vision,visionSignature(bytes,keys,visionConfig().model)))continue;
    calls++;const vision=await readWithVision(bytes,cached.name,reading.text||'',keys);
    if((await sql.one('SELECT hash FROM glpi_tickets WHERE external_id=?', demand.glpi_id))?.hash!==ticket.hash)return;
    if(vision){await sql.run('UPDATE processing_files SET extracted=? WHERE id=?', JSON.stringify({...reading,vision}), cached.id);await sql.run('UPDATE contract_processing SET revision=revision+1 WHERE demand_id=?', did);await invalidate(did);}
   }
  }
  if((await sql.one("SELECT hash FROM glpi_tickets WHERE external_id=?", demand.glpi_id))?.hash===ticket.hash){await saveProcessingResult(did);await auditAsync(did, userId, "Leitura automática do GLPI e validação do preenchimento concluídas; sem escrita no helpdesk.");}
 }catch(error){lastProcessingError.set(did,failureDetail(error));await sql.run("UPDATE contract_processing SET status='Aguardando análise',result=?,updated=? WHERE demand_id=?", JSON.stringify({issues:[{field:"processing",label:"Leitura do chamado",message:"Não foi possível concluir a leitura. Tente novamente."}],values:{},files:[],templates:[]}), now(), did);}
 finally{running.delete(did);activeFiles.delete(did);}
}
let durableQueue:ReadingJobQueue|undefined,draining=false;
const recoveryPaused=async ()=>(await sql.one('SELECT value FROM settings WHERE key=?', 'documentReadingPaused'))?.value==='true';
function currentReadingDocuments(raw:any):{id:string;name:string;mime?:string;sha1?:string}[]{
 const docs=raw.documents||[],superseded=supersededDocuments(docs);
 return docs.filter((doc:any)=>!superseded.has(String(doc.id)));
}
async function recoveryFiles(raw:any,cached:Awaited<ReturnType<typeof filesFor>>){
 const byId=new Map(cached.map(file=>[file.document_id,file]));
 const pending=[];
 for(const doc of currentReadingDocuments(raw)){
  const file=byId.get(String(doc.id));
  if(deferredOcrWorker&&!cachedForOcr(file))continue;
  const scope=contractReadingScope(doc.name||'',file);
  if(awaitsOcr(file))continue;
  if(scope.needsWork&&!(file&&await extractionReviewed(file)))pending.push({doc,file,scope});
 }
 return pending;
}
/** A scan saved by a host without PaddleOCR is retried only where the OCR reader runs. */
function awaitsOcr(file:{extracted:string}|undefined){
 return !readerAvailable()&&markedForOcr(file);
}
function markedForOcr(file:{extracted:string}|undefined){
 try{return !!file&&JSON.parse(file.extracted).awaitingOcr===true;}catch{return false;}
}
function cachedForOcr(file:{extracted:string;byteLength?:number}|undefined){
 return !!file?.byteLength&&markedForOcr(file);
}
const deferredOcrWorker=role==='worker'&&process.env.KEDU_WORKER_DEFERRED_OCR_ONLY==='true';
export async function processingFileProgress(did:string){
 const {ticket}=await processingSource(did);if(!ticket)return {demandId:did,files:[],paused:await recoveryPaused()};
 const raw=JSON.parse(ticket.payload),cached=await filesFor(did,ticket.hash);
 const queue=await sql.one('SELECT state,available_at FROM reading_jobs WHERE demand_id=? AND ticket_hash=?', did, ticket.hash);
 const targets=new Set((await targetedRecovery(did,ticket.hash)).map(({file})=>file.document_id));
 const superseded=supersededDocuments(raw.documents||[]);
 return {demandId:did,paused:await recoveryPaused(),attachmentsUnavailable:raw.documentsAvailable===false,files:(raw.documents||[]).map((doc:any)=>{
  const file=cached.find(f=>f.document_id===String(doc.id));
  const scope=contractReadingScope(doc.name||'',file);
  const excluded=superseded.has(String(doc.id))?'superseded':scope.kind==='support'?'support':scope.kind==='unknown'&&!scope.needsWork?'unknown':undefined;
  return fileProgress(doc,file,queue,activeFiles.get(did),targets.has(String(doc.id)),excluded,scope.needsWork);
 })};
}
async function targetedRecovery(did:string,hash:string,comparisons?:any[]){
 const pending=comparisons||JSON.parse((await sql.one('SELECT result FROM contract_processing WHERE demand_id=?', did))?.result||'{}').comparisons||[];
 const {ticket}=await processingSource(did);
 const current=new Set(currentReadingDocuments(JSON.parse(ticket?.payload||'{}')).map(doc=>String(doc.id)));
 const recovery=[];
 for(const file of await filesFor(did,hash)){
  if(!current.has(file.document_id)||!file.byteLength||file.problem||!isFilledContract(JSON.parse(file.extracted).text||'',file.name)||JSON.parse(file.extracted).triageOnly)continue;
  const extractedHash=sha256(Buffer.from(file.extracted));
  if(await sql.one('SELECT file_id FROM processing_file_reviews WHERE file_id=? AND extraction_hash=?', file.id, extractedHash))continue;
  const protectedFields=(await sql.all('SELECT field FROM processing_field_reviews WHERE file_id=? AND extraction_hash=?', file.id, extractedHash)).map(r=>r.field);
  const reader=/\.pdf$/i.test(file.name)&&process.env.DOCUMENT_DOCLING_ENABLED==='true'&&doclingConfig().ready?'docling':'ocr';
  const targets=targetedReadingTargets(file.name,JSON.parse(file.extracted),pending,protectedFields,reader);
  if(targets.length)recovery.push({file,targets});
 }
 return recovery;
}
async function needsFileRecovery(did:string,hash:string) {
 const cached=await filesFor(did,hash),ticket=await sql.one('SELECT payload FROM glpi_tickets WHERE external_id=(SELECT glpi_id FROM demands WHERE id=?)', did);
 return (await recoveryFiles(JSON.parse(ticket?.payload||'{}'),cached)).length>0;
}
async function needsDemandRecovery(did:string,hash:string) {
 return (await targetedRecovery(did,hash)).length>0||await needsFileRecovery(did,hash);
}
/** Short operator-facing cause; GLPI client messages are already sanitized (no tokens or URLs). */
function failureDetail(error:any){
 const status=Number.isInteger(error?.status)?` (HTTP ${error.status})`:'';
 const message=String(error?.name==='TimeoutError'?'Tempo limite excedido':error?.message||error||'Erro sem mensagem').replace(/https?:\/\/\S+/g,'[url]').replace(/\s+/g,' ').trim();
 return (message+status).slice(0,200);
}
const lastProcessingError=new Map<string,string>();
/** Every pending file was held back by the machine (memory, reader start), not by the file itself. */
export const onlyTemporary=(reason:string)=>!!reason&&reason.split(' | ').every(part=>/Memória disponível insuficiente|falha temporária do leitor|temporariamente indisponível|não pôde ser iniciado/.test(part));
/** Why each document of the demand still needs recovery, recorded on the reading job. */
export async function recoveryReason(did:string,hash:string,ignorePause=false){
 if(!ignorePause&&await recoveryPaused())return 'Leitura automática pausada (documentReadingPaused).';
 const cached=await filesFor(did,hash),ticket=await sql.one('SELECT payload FROM glpi_tickets WHERE external_id=(SELECT glpi_id FROM demands WHERE id=?)', did);
 const reasons=(await recoveryFiles(JSON.parse(ticket?.payload||'{}'),cached)).flatMap(({doc,file})=>{
  const name=String(file?.name||doc.name||doc.id).slice(0,60);
  if(!file)return [`${name}: anexo ainda não baixado`];
  let e:any={};try{e=JSON.parse(file.extracted);}catch{return [`${name}: leitura salva corrompida`];}
  if(!file.byteLength)return [`${name}: download falhou${e.failureDetail?' — '+e.failureDetail:''}`];
  if(file.problem||e.problem)return [`${name}: leitura falhou${e.failureDetail?' — '+e.failureDetail:' — '+String(file.problem||e.problem).slice(0,80)}`];
  if(e.transient)return [`${name}: falha temporária do leitor`];
  if(e.incomplete)return [`${name}: leitura parcial (${e.completedPages?.length||0}/${e.pages||'?'} páginas)`];
  return [`${name}: lido sem texto nem campos reconhecidos`];
 });
 const outer=lastProcessingError.get(did);lastProcessingError.delete(did);
 const targets=(await targetedRecovery(did,hash)).map(({file,targets})=>`${file.name}: releitura direcionada das páginas ${targets.map(t=>t.page).join(', ')}`);
 return [outer&&'Erro no processamento: '+outer,...reasons,...targets].filter(Boolean).join(' | ')||'Recuperação pendente sem causa identificada';
}
async function recoveryProgress(did:string,hash:string){return (await filesFor(did,hash)).reduce((total,f)=>{const e=JSON.parse(f.extracted);return total+(f.byteLength?1:0)+(e.completedPages?.length||0)+Object.keys(e.fields||{}).length;},0);}
/** deadline: stop claiming new jobs after this moment (a serverless invocation has a time limit). */
async function drainReadingQueue(deadline=Infinity) {
 if(draining||await recoveryPaused())return;
 draining=true;
 try {
  while(Date.now()<deadline&&!await recoveryPaused()){
   await yieldToServer();
   const job=await durableQueue!.claim(deferredOcrWorker);if(!job)break;
   const source=await processingSource(job.demand_id);
   if(!source.ticket||source.ticket.hash!==job.ticket_hash||['Concluído','Cancelado','Em assinatura'].includes(source.demand?.stage)){
    await durableQueue!.finish(job,'superseded');continue;
   }
   // Tickets ended in GLPI are read only on request. Reopening changes the version and creates a new job.
   if(closedInGlpi(source.ticket.status)){await durableQueue!.finish(job,'superseded','Chamado encerrado no GLPI: leitura automática pausada; releitura manual disponível.');continue;}
   try {
    if(running.has(job.demand_id)){await durableQueue!.finish(job,'retry','Leitura manual em andamento');continue;}
    const fileRecovery=await needsFileRecovery(job.demand_id,job.ticket_hash);
    const targets=deferredOcrWorker?[]:await targetedRecovery(job.demand_id,job.ticket_hash);
    if(!fileRecovery&&!targets.length){await durableQueue!.finish(job,'done');continue;}
    const before=await recoveryProgress(job.demand_id,job.ticket_hash);
    const targetedOnly=!fileRecovery;
    await processContract(job.demand_id,null,downloadGlpiAttachment,false,targetedOnly,deadline);
    const after=await recoveryProgress(job.demand_id,job.ticket_hash);
    const current=await processingSource(job.demand_id);
    if(current.ticket?.hash!==job.ticket_hash)await durableQueue!.finish(job,'superseded');
    else if(await (deferredOcrWorker?needsFileRecovery:needsDemandRecovery)(job.demand_id,job.ticket_hash)){
     const reason=targetedOnly?'targeted-fields':await recoveryReason(job.demand_id,job.ticket_hash);
     await durableQueue!.finish(job,'retry',reason,after>before?after:undefined,Date.now()>=deadline||!targetedOnly&&onlyTemporary(reason));
    }
    else await durableQueue!.finish(job,'done','',after>before?after:undefined);
   }catch(error){await durableQueue!.finish(job,'retry','Tentativa interrompida; resultados anteriores preservados. '+failureDetail(error));}
  }
 }finally{draining=false;}
}
let scanningRecovery=false;
// Serverless instances overlap: a running job is reclaimed only after outliving any invocation (800 s).
const readingQueue=()=>durableQueue??=new ReadingJobQueue(sql,Date.now,role==='api'||deferredOcrWorker?20*60000:0);
/** Updates saved results and queues every demand whose files still need reading. */
async function scanDemands(deadline=Infinity){
  const queue=readingQueue();
  for(const d of await sql.all("SELECT d.id,t.status FROM demands d JOIN glpi_tickets t ON t.external_id=d.glpi_id WHERE t.mode='real' AND d.stage NOT IN('Concluído','Cancelado','Em assinatura')")){
   await yieldToServer();
   if(Date.now()>=deadline||await recoveryPaused())break;
   if(running.has(d.id))continue;
   if(deferredOcrWorker){
    if(closedInGlpi(d.status))continue;
    const {ticket}=await processingSource(d.id);
    if(ticket&&await needsFileRecovery(d.id,ticket.hash))
     await queue.enqueue(d.id,ticket.hash,false,true);
    continue;
   }
   const job=await ensureProcessing(d.id);
   if(!job)continue;
   const result=JSON.parse(job.result);
   if(job.status==='Analisando'||result.fingerprint!==await fingerprint(d.id))
    await saveProcessingResult(d.id);
   if(closedInGlpi(d.status))continue;
   const fileRecovery=await needsFileRecovery(d.id,job.ticket_hash),targeted=(await targetedRecovery(d.id,job.ticket_hash)).length>0;
   if(fileRecovery||targeted)await queue.enqueue(d.id,job.ticket_hash,targeted&&!fileRecovery,fileRecovery);
   else await queue.settleIdle(d.id,job.ticket_hash);
  }
}
export async function scheduleContractProcessing() {
 // A hosted API (KEDU_ROLE=api) is frozen after each response: reading runs only through runReadingCycle.
 if(process.env.NODE_ENV==='test'||role==='api'||await recoveryPaused()||scanningRecovery)return;
 scanningRecovery=true;
 // Background work continues after the request that started it: no request read cache.
 void readCache.exit(()=>(async()=>{
  readingQueue();
  void drainReadingQueue();
  await scanDemands();
  void drainReadingQueue();
 })()).catch(error=>console.error("Falha ao verificar a fila de leitura:",failureDetail(error)))
   .finally(()=>{scanningRecovery=false;});
}
/** One scheduled pass without a long-running process (a scheduler calling /api/cron/reading): take back stale
 * jobs, queue what still needs reading, then read until the budget ends. The job in progress finishes past
 * the budget. Without PaddleOCR only digital files are read; scans wait for the OCR reader. */
export async function runReadingCycle(budgetMs:number){
 if(await recoveryPaused())return {paused:true};
 const deadline=Date.now()+budgetMs,queue=readingQueue();
 await queue.recoverStale();
 if(!scanningRecovery){scanningRecovery=true;try{await scanDemands(deadline);}finally{scanningRecovery=false;}}
 await drainReadingQueue(deadline);
 return {paused:false,pending:(await sql.one("SELECT COUNT(*) n FROM reading_jobs WHERE state IN('queued','retry','running')")).n};
}
const sqliteSummary=`SELECT d.id AS demand_id,d.stage,t.hash,p.status,p.ticket_hash,p.revision,
  json_array_length(p.result,'$.issues') AS issues,
  CASE WHEN p.status='Aguardando análise' THEN (
   SELECT CASE
    WHEN json_extract(issue.value,'$.field')='contractMissing' AND json_extract(issue.value,'$.label')<>'Aguardando elaboração do contrato' AND (
     json_extract(t.payload,'$.timelineCoverage')='partial'
     OR json_extract(t.payload,'$.approvalCoverage')='partial'
     OR json_extract(t.payload,'$.documentsAvailable')=0
    ) THEN 'Consulta ao GLPI incompleta'
    ELSE json_extract(issue.value,'$.label') END
   FROM json_each(p.result,'$.issues') issue
   WHERE json_extract(issue.value,'$.field')='contractMissing'
    OR json_extract(issue.value,'$.label') IN ('Contrato não lido','Tipo a confirmar')
   LIMIT 1
  ) END AS contract_stage,
  CASE WHEN p.status='Aguardando análise' THEN (
   SELECT json_extract(issue.value,'$.message') FROM json_each(p.result,'$.issues') issue
   WHERE json_extract(issue.value,'$.field')='contractMissing'
    OR json_extract(issue.value,'$.label') IN ('Contrato não lido','Tipo a confirmar')
   LIMIT 1
  ) END AS contract_reason,
  CASE WHEN p.status='Aguardando correção' THEN json_extract(p.result,'$.issues') END AS saved_issues,
  CASE WHEN p.status='Aguardando correção' THEN json_extract(p.result,'$.comparisons') END AS saved_comparisons
  FROM demands d JOIN glpi_tickets t ON t.external_id=d.glpi_id AND t.mode='real'
  LEFT JOIN contract_processing p ON p.demand_id=d.id`;
// Same query for PostgreSQL: JSON is stored as text, so it is cast to jsonb and false is compared as JSON.
const postgresSummary=`SELECT d.id AS demand_id,d.stage,t.hash,p.status,p.ticket_hash,p.revision,
  jsonb_array_length(p.result::jsonb->'issues') AS issues,
  CASE WHEN p.status='Aguardando análise' THEN (
   SELECT CASE
    WHEN issue->>'field'='contractMissing' AND issue->>'label'<>'Aguardando elaboração do contrato' AND (
     t.payload::jsonb->>'timelineCoverage'='partial'
     OR t.payload::jsonb->>'approvalCoverage'='partial'
     OR t.payload::jsonb->'documentsAvailable' IN ('false'::jsonb,'0'::jsonb)
    ) THEN 'Consulta ao GLPI incompleta'
    ELSE issue->>'label' END
   FROM jsonb_array_elements(p.result::jsonb->'issues') issue
   WHERE issue->>'field'='contractMissing'
    OR issue->>'label' IN ('Contrato não lido','Tipo a confirmar')
   LIMIT 1
  ) END AS contract_stage,
  CASE WHEN p.status='Aguardando análise' THEN (
   SELECT issue->>'message' FROM jsonb_array_elements(p.result::jsonb->'issues') issue
   WHERE issue->>'field'='contractMissing'
    OR issue->>'label' IN ('Contrato não lido','Tipo a confirmar')
   LIMIT 1
  ) END AS contract_reason,
  CASE WHEN p.status='Aguardando correção' THEN (p.result::jsonb->'issues')::text END AS saved_issues,
  CASE WHEN p.status='Aguardando correção' THEN (p.result::jsonb->'comparisons')::text END AS saved_comparisons
  FROM demands d JOIN glpi_tickets t ON t.external_id=d.glpi_id AND t.mode='real'
  LEFT JOIN contract_processing p ON p.demand_id=d.id`;
const summarySql=()=>sql.dialect==='postgres'?postgresSummary:sqliteSummary;
async function summaryFromRow(j:any){
 if(["Concluído","Cancelado","Em assinatura"].includes(j.stage))return {status:j.stage,revision:j.revision||0,issues:0};
 if(j.ticket_hash!==j.hash)return {status:"Analisando",revision:j.revision||0};
 const status=j.status==='Aguardando correção'
  ? processingStatus(JSON.parse(j.saved_issues||'[]'),JSON.parse(j.saved_comparisons||'[]')) : j.status;
 if(status!==j.status)await sql.run("UPDATE contract_processing SET status=? WHERE demand_id=?", status, j.demand_id);
 return {status,revision:j.revision,issues:j.issues||0,contractStage:j.contract_stage||undefined,contractReason:j.contract_reason||undefined};
}
export async function processingSummary(did:string) {
 const j=await sql.one(summarySql()+" WHERE d.id=?", did);
 return j?summaryFromRow(j):null;
}
/** processingSummary of every demand with a real ticket, in one query (demand list). */
export async function processingSummaries() {
 const summaries=new Map<string,Awaited<ReturnType<typeof summaryFromRow>>>();
 for(const j of await sql.all(summarySql()))summaries.set(j.demand_id,await summaryFromRow(j));
 return summaries;
}

