import { all,one,run,db,id,now,audit } from "./db.js";
import { downloadGlpiAttachment } from "./glpi-download.js";
import { analyzeTicket,htmlToText,validCnpj } from "./glpi-analysis.js";
import { extractProcessingFile,fieldsFromLines,normalizeValue,inputLabels,norm,editableKeys } from "./processing-extract.js";
import { details } from "./governance.js";
import { listOfficial,sourceOf,homologated,sha256 } from "./official-templates.js";
import { officialRequired,officialProblems,deriveOfficial,derivedFrom } from "../shared/official-fields.js";
import { validateData } from "../shared/data-validation.js";
import { wholeMonths } from "../shared/extenso.js";
import { generate,review } from "./documents.js";
import { readProcessingFile,readerVersion } from "./file-reading.js";
import { invalidate } from "./workflow.js";
import {conversationReferences,requestCompanyReferences,sameRequestedValue,distinctRequestedValues} from './request-expectations.js';
import {installmentTableFields} from './installment-table.js';
import {identifyDocumentHeading,receivedDocumentKind} from '../shared/document-heading.js';
import {attachmentRole,fieldsForRole,automaticReadingCheck,unusedPersonalId} from './reading-policy.js';
import {scopePartyReading,extractContractParties,selectContractParty} from './contract-parties.js';
import {fieldExcerpt,readingGuidance,proposedChanges} from './reading-guidance.js';
import {processingStatus} from './processing-status.js';
import {pendingReason} from '../shared/pending-reason.js';
import {missingFieldEvidence} from './document-evidence.js';
import {validateReadings} from './reading-validation.js';
import {ReadingJobQueue} from './reading-job-queue.js';
import {needsReadingRecovery,preservePreviousReading} from './reading-recovery-policy.js';
import {identityEvidence} from './identity-evidence.js';
import {withDocumentAddress,hasDigitalField,qualifiedNameNeedsReview,digitalFieldOrigin,headerTradeName,legalFormReferenceNeedsReview,referenceTradeNameNeedsReview} from './comparison-evidence.js';
import {recoverTextFields,labelledLocationExcerpt} from './text-recovery.js';
import {assistedVisualField,assistedVisualAbsence} from './assisted-visual-evidence.js';
import {readWithVision,visionConfig,visionSignature,shouldReadVision} from './vision-reading.js';
import {plausibleFieldValue,ownIdentity} from './field-plausibility.js';
import {guidedConfirmation,attachmentWithValue} from './guided-confirmation.js';
import {supersededDocuments} from './document-versions.js';
import {blankImage,blankImageMessage} from './blank-image.js';
import {notApplicableReason,cessionClauseCheck,reportIdentity} from './comparison-profile.js';
import {comparisonReviewReason} from './comparison-review-reason.js';
import {matchesImportedAttachment} from './attachment-cache-proof.js';
import {targetedReadingTargets,mergeTargetedReading} from './targeted-reading.js';
import {comparisonSources} from './comparison-sources.js';
import {fileProgress} from './file-progress.js';
import {readDoclingPage,doclingConfig} from './docling-reader.js';
import {setImmediate as yieldToServer} from "node:timers/promises";
// Tiny images without any text (logos, signatures, illustrations) are not unreadable documents.
const logoImage=(f:any)=>!!f.problem&&/\.(png|jpe?g|gif|webp|bmp)$/i.test(f.name)&&f.byteLength<80000&&/nenhum texto leg/i.test(f.problem);
export function receivedDocumentTypes(did:string) {
 const {ticket}=processingSource(did);if(!ticket)return [];
 const files=filesFor(did,ticket.hash);
 const docs=JSON.parse(ticket.payload).documents||[];
 return [...new Set<string>(docs.map((doc:any)=>{const file=files.find(f=>f.document_id===String(doc.id));return receivedDocumentKind(file?.name||doc.name,file?JSON.parse(file.extracted).text||'':'');}))];
}
export const processingStates=["Analisando","Aguardando análise","Conferência parcial","Aguardando correção","Sem erros"];
type Issue={field:string;label:string;message:string;found?:string;expected?:string;source?:string;missingReason?:string};
/** A registered human resolution applies only while the ticket shows the same reference or finding. */
export const resolutionSignature=(field:string,value:string)=>sha256(Buffer.from(JSON.stringify([field,value])));
const closedInGlpi=(status:unknown)=>['5','6'].includes(String(status));
const running=new Set<string>();
const activeFiles=new Map<string,{documentId:string;targeted?:boolean;page?:number}>();
function fingerprint(did:string) {
 const d=one("SELECT school_id,contract_id,data_version FROM demands WHERE id=?",did);
 return sha256(Buffer.from(JSON.stringify([
  'hybrid-local-ocr-v31-visible-identity-evidence',
  all('SELECT kind,field,signature,value FROM processing_resolutions WHERE demand_id=? ORDER BY kind,field',did),
  d,
  all("SELECT v.id,v.status,s.template_hash,h.template_hash AS approved_hash,i.version_id AS inactive FROM template_sources s JOIN template_versions v ON v.id=s.version_id LEFT JOIN template_homologations h ON h.version_id=v.id LEFT JOIN inactive_template_versions i ON i.version_id=v.id ORDER BY v.id"),
  all("SELECT id,parent_id,sequence,status FROM contracts WHERE school_id=? ORDER BY id",d?.school_id),
  all("SELECT h.matrix_id,h.sequence,h.source,h.id FROM signed_history h JOIN contracts c ON c.id=h.matrix_id WHERE c.school_id=? ORDER BY h.id",d?.school_id),
  all("SELECT h.matrix_id,h.sequence,h.id FROM history_confirmations h JOIN contracts c ON c.id=h.matrix_id WHERE c.school_id=? ORDER BY h.id",d?.school_id),
 ])));
}
export function processingSource(did:string) {
 const demand=one("SELECT * FROM demands WHERE id=?",did);
 const ticket=demand?.glpi_id?one("SELECT * FROM glpi_tickets WHERE external_id=? AND mode='real'",demand.glpi_id):null;
 return {demand,ticket};
}
export function ensureProcessing(did:string) {
 const {ticket}=processingSource(did);if(!ticket)return null;
 run("INSERT OR IGNORE INTO contract_processing(demand_id,ticket_hash,status,updated) VALUES(?,?,'Analisando',?)",did,ticket.hash,now());
 const job=one("SELECT * FROM contract_processing WHERE demand_id=?",did);
 if(job.ticket_hash!==ticket.hash)run("UPDATE contract_processing SET ticket_hash=?,status='Analisando',revision=revision+1,result='{}',updated=? WHERE demand_id=?",ticket.hash,now(),did);
 return one("SELECT * FROM contract_processing WHERE demand_id=?",did);
}
function filesFor(did:string,hash:string) {
 const prefix=hash+":correction:";
 const files=all("SELECT id,demand_id,document_id,ticket_hash,name,mime,extracted,problem,created,length(bytes) AS byteLength,substr(bytes,1,24) AS head FROM processing_files WHERE demand_id=? AND (ticket_hash=? OR substr(ticket_hash,1,?)=?) ORDER BY rowid DESC",did,hash,prefix.length,prefix);
 const seen=new Set<string>();
 return files.filter(f=>{
  if(seen.has(f.document_id))return false;
  seen.add(f.document_id);
  return true;
 });
}
function extractionReviewed(file:any) {
 const hash=sha256(Buffer.from(file.extracted));
 return !!one('SELECT file_id FROM processing_field_reviews WHERE file_id=? AND extraction_hash=? LIMIT 1',file.id,hash)||!!one('SELECT file_id FROM processing_file_reviews WHERE file_id=? AND extraction_hash=?',file.id,hash);
}
function previouslyVerifiedAttachment(did:string,documentId:string,checksum:unknown) {
 if(typeof checksum!=="string"||!(/^[a-f0-9]{40}$/i.test(checksum.trim())))return null;
 for(const {id} of all("SELECT id FROM processing_files WHERE demand_id=? AND document_id=? AND length(bytes)>0 ORDER BY rowid DESC",did,documentId)){
  const previous=one("SELECT id,name,mime,bytes,extracted,problem FROM processing_files WHERE id=?",id);
  if(previous&&matchesImportedAttachment(Buffer.from(previous.bytes),checksum))return previous;
 }
 return null;
}
/** A human check belongs to the exact bytes and extraction, not to the ticket version.
 * Copies only checks of the same extraction, keeping author and date; never creates a new one. */
function carryReviews(fromFileId:string,did:string,documentId:string,hash:string) {
 const target=one('SELECT id,extracted FROM processing_files WHERE demand_id=? AND document_id=? AND ticket_hash=?',did,documentId,hash);
 const extractionHash=sha256(Buffer.from(target.extracted));
 const fields=run('INSERT OR IGNORE INTO processing_field_reviews SELECT ?,field,extraction_hash,value,author,created FROM processing_field_reviews WHERE file_id=? AND extraction_hash=?',target.id,fromFileId,extractionHash).changes;
 const whole=run('INSERT OR IGNORE INTO processing_file_reviews SELECT ?,extraction_hash,author,created FROM processing_file_reviews WHERE file_id=? AND extraction_hash=?',target.id,fromFileId,extractionHash).changes;
 if(fields||whole)audit(did,null,'Conferência humana mantida na nova versão do chamado: mesmo arquivo e mesma extração. Nenhuma nova conferência foi criada.');
}
export function buildProcessingPlan(did:string) {
 const {demand:d,ticket}=processingSource(did),job=one("SELECT * FROM contract_processing WHERE demand_id=?",did);
 if(!d || !ticket || !job)return null;
 const raw=JSON.parse(ticket.payload),analysis=analyzeTicket(raw,{schools:[],matrices:[]});
 const overrides=JSON.parse(job.overrides),values:Record<string,string>={},origins:Record<string,string>={},issues:Issue[]=[];
 const systemLabels:Record<string,string>={template:"Modelo do contrato",templateApproval:"Validação do modelo",history:"Numeração do aditivo",organization:"Organização",files:"Documentos",generation:"Geração do contrato",consistency:"Consistência dos dados"};
 const add=(field:string,message:string,extra:Partial<Issue>={})=>issues.push({field,label:field.startsWith("review:")?"Conferência da leitura":inputLabels[field]||systemLabels[field]||field,message,...extra});
 const {fields:request,corrections:conversationCorrections}=conversationReferences(raw,analysis.fields),candidates:Record<string,{value:string;source:string;fileId:string}[]>={};
 const invalidIdentifiers:Record<string,{fileId:string;fileName:string;value:string;excerpt:string;page?:number;available:boolean}[]>={};
 const filesWithQualifiedParties=new Set<string>();
 const resolutions=all('SELECT * FROM processing_resolutions WHERE demand_id=?',did),references:Record<string,{value:string;note:string;original:string}>={};
 for(const r of resolutions)if(r.kind==='reference'&&request[r.field]?.length&&resolutionSignature(r.field,request[r.field].join("; "))===r.signature){references[r.field]={value:r.value,note:r.note,original:request[r.field].join("; ")};request[r.field]=[r.value];}
 // All versions stay available, but a clearly replaced document no longer speaks for the demand.
 const superseded=supersededDocuments(raw.documents||[]),allFiles=filesFor(did,ticket.hash),files=allFiles.filter(f=>!superseded.has(f.document_id));
 const currentDocuments=(raw.documents||[]).filter((doc:any)=>!superseded.has(String(doc.id))),unusedFiles=new Set<string>();
 // Only a complete search of the ticket can say that a document was not sent.
 const incompleteCoverage=raw.timelineCoverage==='partial'||raw.approvalCoverage==='partial';
 const demandType=analysis.suggestion.type||(d.type!=="A classificar"?d.type:"");
 // A textless small image is a logo only when another attachment carries the document itself.
 const isLogo=(f:any)=>logoImage(f)&&files.some((other:any)=>other!==f&&!other.problem);
 for(const f of files) {
  if(f.problem){if(!isLogo(f))add("file:"+f.document_id,blankImage(f)?blankImageMessage:f.problem,{source:f.name});continue;}
  const saved=JSON.parse(f.extracted);
  const fields={...saved.fields,...recoverTextFields(saved.text||'',saved.fields||{})};
  const enriched={...saved,fields:Object.fromEntries(Object.entries(fields).map(([key,vs])=>[key,(vs as string[]).map(v=>normalizeValue(key,v)).filter(Boolean)]))};
  const partyScope=scopePartyReading(enriched,request.cnpj?.length===1?request.cnpj[0]:undefined);
  if(partyScope.parties.length)filesWithQualifiedParties.add(f.id);
  const extracted:any={...partyScope.reading,fields:withDocumentAddress(partyScope.reading.fields||{})};
  const role=attachmentRole(f.name,extracted.text||'');
  const extractedHash=sha256(Buffer.from(f.extracted)),wholeReviewed=!!one('SELECT file_id FROM processing_file_reviews WHERE file_id=? AND extraction_hash=?',f.id,extractedHash);
  const scopedFields=fieldsForRole(role,extracted.fields),fieldChecks=all('SELECT field,value,extraction_hash FROM processing_field_reviews WHERE file_id=?',f.id);
  const checkedAllFields=Object.keys(scopedFields).length>0&&Object.entries(scopedFields).every(([key,values])=>values.length===1&&fieldChecks.some(check=>check.field===key&&check.extraction_hash===extractedHash&&sameRequestedValue(key,check.value,values[0])));
  if(role==='document'&&partyScope.parties.length&&!partyScope.selected)add('review:parties:'+f.id,'Há mais de uma parte contratual possível. Identifique a empresa correspondente ao chamado; os CNPJs das partes não foram misturados.',{label:'Identificação da parte contratual',source:f.name});
  if(extracted.incomplete)add('review:partial:'+f.id,'A leitura foi interrompida. Os trechos já lidos foram preservados, mas é necessário conferir as páginas restantes e enviar uma cópia completa legível.',{label:'Leitura parcial',source:f.name});
  if(role==='counterproposal')add('review:counterproposal:'+f.id,'Este anexo é uma contraproposta. As condições originais e propostas precisam ser decididas antes de preencher o contrato; nenhum desses valores foi adotado automaticamente.',{label:'Contraproposta — conferir alterações solicitadas',source:f.name});
  if(extracted.needsReview && role!=='report' && !automaticReadingCheck(extracted,role,request) && !wholeReviewed && !checkedAllFields)add("review:"+f.id,readingGuidance(extracted,role),{label:"Conferência de leitura: "+f.name,source:f.name});
  if(extracted.needsReview&&extracted.formulaCount>0&&checkedAllFields&&!wholeReviewed)add('review:formulas:'+f.id,'Os campos foram conferidos individualmente, mas a planilha contém fórmulas. Confira o original e confirme a leitura completa; cálculos não foram executados pelo portal.',{label:'Cálculos da planilha',source:f.name});
  // Implausible values (labels, malformed numbers) and this portal's own identity are reading artifacts, not document data.
  for(const [key,vs] of Object.entries(scopedFields))for(const value of vs){
   if(ownIdentity(key,value)&&!request[key]?.some(r=>ownIdentity(key,r)))continue;
   if(plausibleFieldValue(key,value)){
    (candidates[key]||=[]).push({value,source:f.name+(partyScope.selected&&['cnpj','razaoSocial'].includes(key)?' — parte '+partyScope.selected.role:''),fileId:f.id});
    continue;
   }
   if(!['cnpj','representanteCpf','documentoTitular'].includes(key)||!/^\d[\d.\/\s-]+\d$/.test(value)||!(key==='representanteCpf'?[11]:[11,14]).includes(value.replace(/\D/g,'').length))continue;
   const excerpt=key==='cnpj'&&partyScope.selected?partyScope.selected.excerpt:fieldExcerpt(extracted.text||'',[value]);
   if(excerpt)(invalidIdentifiers[key]||=[]).push({fileId:f.id,fileName:f.name,value,excerpt,page:extracted.pages===1?1:undefined,available:!!f.byteLength});
  }
  // Settlement reports identify the school; their figures are never adopted.
  if(role==='report'&&/descredenciamento/i.test(demandType)){const id=reportIdentity(extracted.text||'');if(id)for(const [key,value] of Object.entries(id))if(value)(candidates[key]||=[]).push({value,source:f.name+' — identificação no relatório',fileId:f.id});}
  if(analysis.suggestion.type==="Parcelamento"){
   const count=request.parcelas?.length===1?request.parcelas[0]:undefined;
   const table=installmentTableFields(extracted.text||"",count);
   for(const [key,vs] of Object.entries(table))for(const value of vs)(candidates[key]||=[]).push({value,source:f.name+" — linha de "+count+" parcelas da simulação (conferir com o original)",fileId:f.id});
   if(Object.keys(table).length)add("review:simulation:"+f.id,"O anexo contém uma simulação com alternativas de parcelamento. Os valores foram lidos na linha da quantidade solicitada; é necessário conferir e obter o instrumento contratual correspondente.",{label:"Simulação de parcelamento",source:f.name});
  }
 }
 for(const doc of currentDocuments)if(!files.some(f=>f.document_id===String(doc.id)))add("file:"+doc.id,"Não foi possível obter este anexo. Tente novamente ou envie uma cópia DOCX.",{source:doc.name});
 // A supporting OCR file need not be confirmed twice when every extracted field
 // is independently present with the same value in a fully digital document.
 for(const f of files){
  const e=JSON.parse(f.extracted),role=attachmentRole(f.name,e.text||'');
  if((!['bank','registration'].includes(role)&&e.method!=='XLSX')||e.incomplete||f.problem)continue;
  const supporting=Object.entries(fieldsForRole(role,e.fields||{}));
  if(!supporting.length)continue;
  const corroborated=supporting.every(([key,vs])=>vs.length===1 && (candidates[key]||[]).some(c=>{
   if(c.fileId===f.id||!sameRequestedValue(key,c.value,vs[0]))return false;
   const source=files.find(other=>other.id===c.fileId);if(!source||source.problem)return false;
   const reading=JSON.parse(source.extracted);
   return attachmentRole(source.name,reading.text||'')==='document'&&(hasDigitalField(reading,key,c.value)||(!reading.needsReview&&!reading.incomplete));
  }));
  if(corroborated){const index=issues.findIndex(i=>i.field==='review:'+f.id);if(index>=0)issues.splice(index,1);}
 }
 if(!raw.documents?.length)add("files",incompleteCoverage?"Nenhum anexo foi identificado, mas a consulta ao GLPI ficou incompleta. Confira o chamado antes de pedir o documento.":"O chamado não contém contrato anexado. É necessário obter o documento.",incompleteCoverage?{missingReason:'coverage_partial'}:{});
 if(files.length && files.every(f=>['report','bank','registration'].includes(attachmentRole(f.name,JSON.parse(f.extracted).text||''))))add('contractMissing','Os anexos recebidos são documentos de apoio. Obtenha o instrumento contratual correspondente; relatórios e comprovantes não foram utilizados como contrato.',{label:'Instrumento contratual não recebido'});
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
  const value=key==='cnpj'&&request.cnpj?.length===1?request.cnpj[0]:normalizeValue(key,analysis.fields[key].value);
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
 const evidenceFiles=currentDocuments.filter((doc:any)=>{const f=files.find(f=>f.document_id===String(doc.id));return !f||!isLogo(f);}).map((doc:any)=>{const f=files.find(f=>f.document_id===String(doc.id));const e=f?JSON.parse(f.extracted):{};return {name:f?.name||doc.name||'Anexo',text:e.text||'',emptyContent:!!f&&blankImage(f),problem:f?.problem||(!f?'Anexo ainda não obtido':''),incomplete:!!e.incomplete,downloadFailed:!!f&&!f.byteLength&&!!f.problem,downloadPending:!f};});
 if(raw.documentsAvailable===false&&!evidenceFiles.length)evidenceFiles.push({name:'Lista de anexos indisponível no GLPI',text:'',problem:'Não foi possível consultar os anexos',incomplete:false,downloadFailed:false,downloadPending:true});
 const profileFiles=files.filter(f=>!isLogo(f)).map(f=>{const e=JSON.parse(f.extracted);return {name:f.name,text:e.text||'',problem:f.problem,incomplete:!!e.incomplete,method:e.method};});
 const comparisons:any[]=Object.entries(request).filter(([key])=>comparable.has(key)).map(([key,expected])=>{
  const located=distinctRequestedValues(key,(candidates[key]||[]).map(c=>c.value));
  // No extractor captured the field, but the exact requested value is printed in an attachment.
  const guided=!located.length&&expected.length===1?guidedConfirmation(key,expected[0],['cnpj','razaoSocial'].includes(key)?files.filter(f=>!filesWithQualifiedParties.has(f.id)):files):undefined;
  const found=guided?[guided.value]:located;
  const companies=key==='cnpj'&&expected.length>1?requestCompanyReferences(raw.content):[];
  const invalidReference=expected.length===1&&['cnpj','representanteCpf','documentoTitular'].includes(key)&&!plausibleFieldValue(key,expected[0]);
  const corrected=expected.length===1 && Object.hasOwn(overrides,key) && sameRequestedValue(key,String(overrides[key]),expected[0]);
  const invalidEvidence=invalidIdentifiers[key];
  if(!found.length&&!corrected&&invalidEvidence?.length){
   const message=invalidReference?'O identificador foi lido no documento e a referência do GLPI também é inválida. Confirme ambos com a fonte cadastral.':'O identificador foi lido no documento, mas os dígitos verificadores são inválidos. Confira a fonte cadastral antes de corrigir o preenchimento.';
   return {field:key,label:inputLabels[key]||key,status:invalidReference||expected.length>1?'ambiguous':'review',readingPending:true,
    expected:expected.join('; '),found:distinctRequestedValues(key,invalidEvidence.map(item=>item.value)).join('; '),
    evidence:invalidEvidence,message,reviewReason:{code:'invalid_identifier',message}};
  }
  const matches=expected.length===1 && found.length>0 && found.every(v=>sameRequestedValue(key,v,expected[0]));
  const tradeName=key==='razaoSocial'&&!matches&&!guided&&!!candidates[key]?.length&&candidates[key].every(c=>headerTradeName(JSON.parse(files.find(f=>f.id===c.fileId)!.extracted).text,c.value));
  // Several values where one equals the request (branches, partners, witnesses) need a check, not a correction.
  const partlyMatches=!matches && expected.length===1 && found.length>1 && found.some(v=>sameRequestedValue(key,v,expected[0]));
  const previousVersion=!found.length&&currentDocuments.some((doc:any)=>!files.some(f=>f.document_id===String(doc.id))&&one('SELECT id FROM processing_files WHERE demand_id=? AND document_id=? LIMIT 1',did,String(doc.id)));
  const visuallyAbsent=!found.length&&files.length>0&&files.every(f=>!f.problem&&assistedVisualAbsence(JSON.parse(f.extracted),key));
  const fieldEvidence=missingFieldEvidence(key,evidenceFiles,incompleteCoverage);
  // Shows where the value is printed so a person can check it; the field stays pending.
  const valueSource=!found.length&&expected.length===1?attachmentWithValue(key,expected[0],files):undefined;
  const evidence=previousVersion?{...fieldEvidence,reason:'awaiting_version',message:'O chamado foi atualizado. A leitura disponível pertence à versão anterior; aguardando obter e conferir os anexos da versão atual.'}:visuallyAbsent?{...fieldEvidence,reason:'not_printed',message:'Os anexos foram conferidos visualmente e este dado não está informado. Solicite um documento que o contenha ou esclareça o pedido; não se trata de falha de OCR.'}:valueSource?{...fieldEvidence,reason:'value_unassociated',message:`O valor aparece em "${valueSource}", mas sem rótulo ou entidade que o ligue a este campo. Confira o trecho no original; isto não confirma o campo.`}:fieldEvidence;
  const notApplicable=!found.length&&!corrected&&expected.length===1?notApplicableReason(demandType,key,profileFiles):'';
  if(!found.length && !corrected && !notApplicable && !issues.some(i=>i.field===key))add(key,evidence.message,{expected:expected.join("; "),source:evidence.expectedDocument});
  // Certainty concerns the extracted value, independently of agreement with GLPI.
  // One proven mismatch must not become inconclusive because a duplicate OCR
  // attachment supplies the same value but has lower reading confidence.
  const trustedReading=found.length===1&&(candidates[key]||[]).some(c=>{
   const file=files.find(f=>f.id===c.fileId)!;
   const reading=JSON.parse(file.extracted),role=attachmentRole(file.name,reading.text||'');
   if(file.problem)return false;
   if(issues.some(i=>i.field.startsWith('review:')&&i.field.endsWith(c.fileId)&&!['review:'+c.fileId,'review:partial:'+c.fileId].includes(i.field)))return false;
   if(hasDigitalField(reading,key,c.value))return true;
   if(reading.incomplete)return false;
   const hash=sha256(Buffer.from(file.extracted));
   if(one('SELECT file_id FROM processing_file_reviews WHERE file_id=? AND extraction_hash=?',file.id,hash))return true;
   const checked=one('SELECT value FROM processing_field_reviews WHERE file_id=? AND field=? AND extraction_hash=?',file.id,key,hash);
   if(checked&&sameRequestedValue(key,checked.value,c.value))return true;
   return !reading.needsReview||automaticReadingCheck({...reading,fields:{[key]:[c.value]}},role,request);
  });
  const referenceTradeName=key==='razaoSocial'&&(candidates[key]||[]).some(c=>{
   const reading=JSON.parse(files.find(f=>f.id===c.fileId)!.extracted);
   return referenceTradeNameNeedsReview(key,found,expected,request.cnpj||[],{...reading.fields,...recoverTextFields(reading.text||'',{})});
  });
  const confirmedMatch=matches&&!invalidReference&&(!guided||guided.associated);
  const needsFieldReview=!confirmedMatch&&(referenceTradeName||legalFormReferenceNeedsReview(key,found,expected)||tradeName||!!guided&&!guided.associated||qualifiedNameNeedsReview(key,found,expected)||!trustedReading&&(candidates[key]||[]).some(c=>{
   const pending=issues.filter(i=>i.field.startsWith('review:')&&i.field.endsWith(c.fileId));
   if(!pending.length)return false;
   // Structural, partial and legal reviews remain independent of OCR certainty.
   if(pending.some(i=>i.field!=='review:'+c.fileId))return true;
   const file=files.find(f=>f.id===c.fileId)!;
   const reading=JSON.parse(file.extracted),role=attachmentRole(file.name,reading.text||'');
   const confirmed=one('SELECT value FROM processing_field_reviews WHERE file_id=? AND field=? AND extraction_hash=?',file.id,key,sha256(Buffer.from(file.extracted)));
   if(!reading.incomplete&&confirmed&&sameRequestedValue(key,confirmed.value,c.value))return false;
   return !automaticReadingCheck({...reading,fields:{[key]:[c.value]}},role,request);
  }));
  const bankHolderContext=key==='razaoSocial'&&guided&&!guided.associated?distinctRequestedValues('titularConta',(candidates.titularConta||[]).map(c=>c.value)):[];
  const reviewReason=bankHolderContext.length===1?{code:'commercial_name_bank_holder',message:'O nome aparece no comunicado, mas não como razão social. O titular bancário declarado é '+bankHolderContext[0]+'. Confirme o vínculo entre o nome comercial e a pessoa jurídica; não foi presumida equivalência.'}:needsFieldReview||partlyMatches?comparisonReviewReason({referenceTradeName,referenceNameTypo:legalFormReferenceNeedsReview(key,found,expected),tradeName,guided:!!guided&&!guided.associated,qualifiedName:qualifiedNameNeedsReview(key,found,expected),conflictingValues:partlyMatches,readings:(candidates[key]||[]).map(c=>JSON.parse(files.find(f=>f.id===c.fileId)!.extracted)),field:key}):undefined;
  if(reviewReason&&['reference_trade_name','reference_name_typo'].includes(reviewReason.code))for(const issue of issues.filter(i=>i.field===key))issue.message=reviewReason.message;
  const correction=conversationCorrections[key];
  return {field:key,referenceResolution:references[key],referenceCorrection:correction&&expected.length===1&&sameRequestedValue(key,expected[0],correction.value)?correction:undefined,reviewReason,matchesReference:matches,partlyMatches,expectedEntities:companies,message:companies.length>1?'O chamado menciona mais de uma empresa. Os CNPJs foram separados; confira cada arquivo com a empresa correspondente. O CNPJ do titular bancário não comprova, sozinho, o CNPJ do contrato social.':invalidReference?'O documento informado no GLPI tem quantidade de dígitos ou dígitos verificadores inválidos. Confirme a referência no chamado antes de solicitar alteração do arquivo.':undefined,missingReason:!found.length?evidence.reason:undefined,expectedDocument:evidence.expectedDocument,sourceDocuments:evidence.sourceDocuments,readingPending:needsFieldReview||partlyMatches,label:key==='cnpj'&&expected.length===1&&expected[0].replace(/\D/g,'').length===11?'CPF':analysis.suggestion.type==="Parcelamento" && key==="valor"?"Valor parcelado":analysis.suggestion.type==="Parcelamento" && key==="parcelas"?"Quantidade de parcelas":inputLabels[key]||key,expected:expected.join("; "),found:found.join("; "),source:guided?guided.source+(guided.associated?" (valor localizado junto ao rótulo do campo)":" (valor do chamado localizado no texto)"):[...new Set((candidates[key]||[]).map(c=>c.source))].join("; "),used:values[key]||"",note:notApplicable||undefined,status:invalidReference||expected.length>1?"ambiguous":corrected?"corrected":notApplicable?"not_applicable":!found.length?"missing":needsFieldReview||partlyMatches?"review":!matches?"different":"matches"};
 });
 // Confidence belongs to the requested fields. Unused OCR fields must not keep an otherwise
 // completely read file pending after every requested field it supplies has independent proof.
 for(const f of files){
  const index=issues.findIndex(i=>i.field==='review:'+f.id);if(index<0||f.problem)continue;
  const e=JSON.parse(f.extracted),role=attachmentRole(f.name,e.text||'');
  // Unrequested calculations do not invalidate an identity read from literal
  // workbook cells. Financial/calculated fields never qualify for this rule.
  const literalRelated=comparisons.filter(c=>request[c.field]?.length&&(candidates[c.field]||[]).some(v=>v.fileId===f.id));
  if(/^XLSX(?: com OCR)?$/.test(e.method||'')&&e.literalIdentityFields&&literalRelated.length&&literalRelated.every(c=>c.status==='matches'&&!c.readingPending&&['cnpj','razaoSocial','nomeFantasia'].includes(c.field)&&e.literalIdentityFields[c.field]?.length===1)){
   issues.splice(index,1);continue;
  }
  if(e.incomplete||(e.formulaCount||0)>0||['counterproposal','simulation','report'].includes(role))continue;
  if(issues.some(i=>i.field.startsWith('review:')&&i.field.endsWith(f.id)&&i.field!=='review:'+f.id))continue;
  const related=comparisons.filter(c=>request[c.field]?.length&&(candidates[c.field]||[]).some(v=>v.fileId===f.id));
  // A completely read file that supplies no requested field does not block the demand once every
  // requested field is resolved by another source. It stays visible as not used.
  if(!related.length&&comparisons.length&&comparisons.every(c=>['matches','corrected','not_applicable'].includes(c.status)&&!c.readingPending)){issues.splice(index,1);unusedFiles.add(f.id);continue;}
  if(!Number.isInteger(e.pages)||e.pages<1)continue;
  if(!related.length&&unusedPersonalId(e,f.name,request,comparisons)){issues.splice(index,1);continue;}
  if(related.length&&related.every(c=>c.status==='matches'&&!c.readingPending))issues.splice(index,1);
 }
 const cession=cessionClauseCheck(demandType,profileFiles);
 if(cession){comparisons.push(cession);if(cession.status!=='matches')add('clausulaCessao',cession.message,{label:cession.label});}
 const validationFindings=validateReadings(files.filter(f=>!f.problem).map(f=>{const scoped=scopePartyReading(JSON.parse(f.extracted),request.cnpj?.length===1?request.cnpj[0]:undefined).reading;const fields=fieldsForRole(attachmentRole(f.name,scoped.text||''),scoped.fields);return {name:f.name,fields:Object.fromEntries(Object.entries(fields).map(([key,vs])=>[key,vs.filter(v=>plausibleFieldValue(key,v))]))};}));
 for(const finding of validationFindings){
  const resolved=resolutions.find(r=>r.kind==='validation'&&r.field===finding.field&&r.signature===resolutionSignature(finding.field,finding.found));
  if(resolved){finding.resolution={note:resolved.note,created:resolved.created};continue;}
  add('review:validation:'+finding.field,finding.message,{label:inputLabels[finding.field]||finding.field,found:finding.found,source:finding.source});
 }
 if(!values.duracaoMeses && values.inicio && values.fim)try{const months=wholeMonths(values.inicio,values.fim);if(months!==null && months>0){values.duracaoMeses=String(months);origins.duracaoMeses="Calculado a partir das datas exatas de início e fim";}}catch{}
 if(!d.school_id)add("organization","Identifique e cadastre a organização correta antes de gerar o contrato.");
 else {const school=one("SELECT cnpj FROM schools WHERE id=?",d.school_id);if(values.cnpj && school?.cnpj.replace(/\D/g,"")!==values.cnpj.replace(/\D/g,""))add("cnpj","O CNPJ informado difere da organização vinculada à demanda.",{found:values.cnpj,expected:school?.cnpj});}
 const documentTypes=[...new Set(files.filter(f=>!f.problem).map(f=>identifyDocumentHeading(f.name,JSON.parse(f.extracted).text||"").type).filter(t=>t && t!=="Contrato"))];
 const type=analysis.suggestion.type || (d.type!=="A classificar"?d.type:documentTypes.length===1?documentTypes[0]:"");
 const subtype=analysis.suggestion.subtype || details(d).subtype || "";
 const templates=listOfficial().filter(t=>!t.inactive && (!type || t.document_type===type) && (t.document_type!=="Aditivo" || !subtype || t.subtype===subtype));
 const eligible=templates.filter(t=>!t.modality || t.modality===values.modalidade);
 let template=job.template_id?templates.find(t=>t.version_id===job.template_id):eligible.length===1?eligible[0]:null;
 if(template?.modality && values.modalidade && template.modality!==values.modalidade)template=null;
 // Without an official model the result is the list of errors; asking for a model or its fields is noise.
 if(!template&&templates.length)add("template","Confirme o modelo correspondente ao pedido.");
 let version:any=null,sequence:number|null=null,matrix:any=null;
 const actualType=template?.document_type || type,actualSubtype=template?.subtype || subtype;
 if(template) {
  if(template.modality && !values.modalidade)values.modalidade=template.modality;
  version=one("SELECT * FROM template_versions WHERE id=?",template.version_id);
  if(!version || !homologated(version))add("templateApproval","O modelo correspondente aguarda homologação jurídica em Modelos.");
  if(actualType==="Aditivo") {
   const own=one("SELECT * FROM contracts WHERE id=?",d.contract_id);
   const matrices=all("SELECT * FROM contract_registry WHERE school_id=? AND instrument_kind='Matriz' AND status='Assinado'",d.school_id);
   matrix=matrices.find(m=>m.id===(values.matriz || own?.parent_id)) || (matrices.length===1?matrices[0]:null);
   if(!matrix)add("matriz","Vincule o contrato matriz assinado desta organização.");
   else {
    values.matriz=matrix.id;
    const history=one("SELECT * FROM signed_history WHERE matrix_id=? ORDER BY sequence DESC LIMIT 1",matrix.id);
    if(own?.parent_id===matrix.id)sequence=own.sequence;
    else if(!history)add("history","Confirme o último aditivo efetivamente assinado no cadastro da matriz.");
    else if(history.source==="Registro local" && !one("SELECT id FROM history_confirmations WHERE matrix_id=? AND sequence=?",matrix.id,history.sequence))add("history","Reconﬁrme o último aditivo assinado no Clicksign/Clint.");
    else {sequence=history.sequence+1;if(one("SELECT id FROM contracts WHERE parent_id=? AND sequence=?",matrix.id,sequence))add("history","O próximo número já está reservado por outra demanda. Confira a numeração antes de continuar.");}
    if(!values.dataAssinaturaMatriz){const external=one("SELECT signature_date FROM external_contract_files WHERE contract_id=?",matrix.id);if(external)values.dataAssinaturaMatriz=external.signature_date;}
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
  for(const slot of JSON.parse(sourceOf(version.id).slots))if(!["avisoHomologacao","pix"].includes(slot) && !derived[slot]?.trim()){
   const key=derivedFrom[slot]||slot;
   if(!issues.some(i=>i.field===key) && key!=="aditivo")add(key,"Falta informação necessária para preencher o modelo.");
  }
  if(!issues.length){generated=generate(Buffer.from(version.bytes),derived);if(review(generated,derived,Buffer.from(version.bytes)).status!=="conforme"){generated=null;add("generation","A conferência do documento gerado encontrou divergência. O download permanece bloqueado.");}}
 }catch{add("generation","Não foi possível preencher o modelo com estes dados. Confira o modelo e os campos indicados.");}
 const typeIdentification={type:actualType||"Não identificado",source:analysis.suggestion.type?analysis.suggestion.basis:d.type!=="A classificar"?"Classificação registrada na demanda":documentTypes.length===1?"Título no início do documento ou nome do arquivo":"Conferência manual necessária",ticketTitle:raw.title,correction:templates.length?"Modelo oficial":"Lista de erros (tipo sem modelo oficial)"};
 return {demand:d,ticket,job,values,origins,issues:issues.map(issue=>({...issue,pendingReason:pendingReason({...issue,...comparisons.find(c=>c.field===issue.field)})})),comparisons,validationFindings,typeIdentification,template,templates,version,sequence,matrix,derived,generated,type:actualType,subtype:actualSubtype,
  files:allFiles.map(f=>{const scope=scopePartyReading(JSON.parse(f.extracted),request.cnpj?.length===1?request.cnpj[0]:undefined),e=scope.reading;return {
   parties:scope.parties,selectedParty:scope.selected,vision:e.vision,
   guidance:readingGuidance(e,attachmentRole(f.name,e.text||'')),changes:proposedChanges(e.text||''),
   fieldReviews:[...new Set([...Object.keys(candidates).filter(key=>candidates[key].some(c=>c.fileId===f.id)),...Object.keys(request).filter(key=>missingFieldEvidence(key,[{name:f.name,text:e.text||''}]).reason!=='not_sent')])].map(key=>{
    const vs=candidates[key]||[];
    const values=distinctRequestedValues(key,vs.filter(c=>c.fileId===f.id).map(c=>c.value));
    const check=one('SELECT * FROM processing_field_reviews WHERE file_id=? AND field=?',f.id,key);
    const evidence=values.length===1?(digitalFieldOrigin(e,key,values[0])||identityEvidence(e,key,values[0],attachmentRole(f.name,e.text||''))):null;
    const assisted=values.length===1?assistedVisualField(e,key,values[0],attachmentRole(f.name,e.text||'')):null;
    const observations=values.map(value=>{
     const origin=assistedVisualField(e,key,value,attachmentRole(f.name,e.text||''))||digitalFieldOrigin(e,key,value)||e.fieldOrigins?.[key]?.find((o:any)=>sameRequestedValue(key,o.value,value));
     return {value,page:origin?.page||(e.pages===1?1:undefined),excerpt:origin?.excerpt||fieldExcerpt(e.text||'',[value])||(scope.selected&&['cnpj','razaoSocial'].includes(key)?scope.selected.excerpt:'')||labelledLocationExcerpt(e.text||'',key,value)};
    });
    return {key,label:inputLabels[key]||key,values,observations,expected:request[key]||[],assistedVisualReview:!!assisted,page:assisted?.page||evidence?.page||e.fieldOrigins?.[key]?.[0]?.page||(e.pages===1?1:undefined),excerpt:assisted?.excerpt||evidence?.excerpt||(scope.selected&&['cnpj','razaoSocial'].includes(key)?scope.selected.excerpt:fieldExcerpt(e.text||'',values)),confirmed:!!check&&check.extraction_hash===sha256(Buffer.from(f.extracted))&&values.length===1&&sameRequestedValue(key,check.value,values[0])};
   }),
   available:!!f.byteLength,incomplete:!!e.incomplete,role:attachmentRole(f.name,e.text||''),notUsed:unusedFiles.has(f.id),supersededBy:superseded.get(f.document_id),
   readingValidatedAutomatically:automaticReadingCheck(e,attachmentRole(f.name,e.text||''),request),
   reviewFields:Object.entries(candidates).filter(([,vs])=>vs.some(c=>c.fileId===f.id)).map(([key])=>inputLabels[key]||key),
   warnings:e.warnings||[],ocrEngine:e.ocrEngine,preprocessing:e.preprocessing||[],formulaCount:e.formulaCount||0,calculatedFields:Object.entries(e.calculatedFields||{}).map(([key,values])=>({key,label:inputLabels[key]||key,values})),identification:identifyDocumentHeading(f.name,e.text||""),id:f.id,document_id:f.document_id,name:f.name,mime:f.mime,problem:f.problem,method:e.method,confidence:e.confidence,pages:e.pages,
   needsReview:!!e.needsReview && !e.incomplete && issues.some(i=>i.field==='review:'+f.id||i.field==='review:formulas:'+f.id),corrected:f.ticket_hash.includes(":correction:"),text:e.text?.slice(0,500000)||""};})};
}
export function saveProcessingResult(did:string) {
 const plan=buildProcessingPlan(did);if(!plan)return null;
 const result={values:plan.values,origins:plan.origins,issues:plan.issues,comparisons:plan.comparisons.map(row=>({...row,evidence:row.evidence||comparisonSources(row,plan.files)})),validationFindings:plan.validationFindings,typeIdentification:plan.typeIdentification,template:plan.template,templates:plan.templates,files:plan.files,type:plan.type,subtype:plan.subtype,fingerprint:fingerprint(did)};
 const hasReadableDocument=plan.files.some(file=>file.available&&!!file.text?.trim()&&!file.supersededBy);
 const status=processingStatus(plan.issues,plan.comparisons,hasReadableDocument);
 run("UPDATE contract_processing SET status=?,result=?,updated=? WHERE demand_id=?",status,JSON.stringify(result),now(),did);
 return {status,revision:plan.job.revision,ticket_hash:plan.ticket.hash,...result};
}
export async function processContract(did:string,userId:string|null=null,download:(ticketId:string,documentId:string,signal:AbortSignal)=>Promise<{bytes:Buffer;name:string;mime:string}>=downloadGlpiAttachment,force=false,targetedOnly=false) {
 if(running.has(did))return;const job=ensureProcessing(did);if(!job)return;
 running.add(did);run("UPDATE contract_processing SET status='Analisando',updated=? WHERE demand_id=?",now(),did);
 const {demand,ticket}=processingSource(did);
 try {
  const raw=JSON.parse(ticket.payload);
  for(const doc of (targetedOnly?[]:raw.documents||[])) {
   if(recoveryPaused()&&!force&&userId===null)break;
   const cached=filesFor(did,ticket.hash).find(f=>f.document_id===String(doc.id));
   if(cached?.byteLength&&!force&&extractionReviewed(cached))continue;
   if(!force&&!needsReadingRecovery(cached))continue;
   activeFiles.set(did,{documentId:String(doc.id)});
   let file:any,extracted:any,reusedFrom:string|undefined;
   try {
    const provenPrevious=!cached?.byteLength?previouslyVerifiedAttachment(did,String(doc.id),doc.sha1):null;
    if(cached?.byteLength)file={name:cached.name,mime:cached.mime,bytes:Buffer.from(one('SELECT bytes FROM processing_files WHERE id=?',cached.id).bytes)};
    else if(provenPrevious)file={name:doc.name||provenPrevious.name,mime:provenPrevious.mime,bytes:Buffer.from(provenPrevious.bytes)};
    else for(let attempt=0;attempt<3;attempt++){
     try {file=await download(demand.glpi_id,String(doc.id),AbortSignal.timeout(30000));if(!file.bytes.length)throw Error('Arquivo vazio.');break;}
     catch(error:any){
      if(attempt===2 || [400,401,403,404].includes(error?.status))throw error;
      await new Promise(resolve=>setTimeout(resolve,750*2**attempt));
     }
    }
    const previous=provenPrevious||(!cached?.byteLength?one('SELECT id,extracted,problem,bytes FROM processing_files WHERE demand_id=? AND document_id=? AND length(bytes)>0 ORDER BY rowid DESC LIMIT 1',did,String(doc.id)):null);
    // A changed ticket can retain the exact same attachment. Verify current GLPI bytes before reuse.
    if(previous&&!previous.problem&&sha256(Buffer.from(previous.bytes))===sha256(file.bytes)&&!needsReadingRecovery({byteLength:file.bytes.length,extracted:previous.extracted})){extracted=JSON.parse(previous.extracted);reusedFrom=previous.id;}
    else extracted=await readProcessingFile(file.bytes,file.name);
   }
   catch(error){file??={name:doc.name,mime:doc.mime||"application/octet-stream",bytes:Buffer.alloc(0)};extracted={version:readerVersion,text:"",fields:{},problem:file.bytes.length?"O original está disponível, mas a leitura falhou. Confira o arquivo ou envie uma cópia acessível.":"Não foi possível baixar o anexo após as tentativas de recuperação. Confira a disponibilidade no GLPI.",failureDetail:failureDetail(error),method:'inconclusiva',needsReview:false};}
   if(one("SELECT hash FROM glpi_tickets WHERE external_id=?",demand.glpi_id)?.hash!==ticket.hash)return;
   // A crashed or unavailable reader never replaces a reading that already worked; it is retried later.
   if(preservePreviousReading(cached?.extracted,extracted)){activeFiles.delete(did);continue;}
   if(cached?.byteLength)run("UPDATE processing_files SET extracted=?,problem=? WHERE id=?",JSON.stringify(extracted),extracted.problem,cached.id);
   else {
    db.exec('BEGIN IMMEDIATE');
    try {
     run("INSERT INTO processing_files VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(demand_id,document_id,ticket_hash) DO UPDATE SET name=excluded.name,mime=excluded.mime,bytes=excluded.bytes,extracted=excluded.extracted,problem=excluded.problem,created=excluded.created",id(),did,String(doc.id),ticket.hash,file.name,file.mime,file.bytes,JSON.stringify(extracted),extracted.problem,now());
     if(reusedFrom)carryReviews(reusedFrom,did,String(doc.id),ticket.hash);
     db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
   }
   run("UPDATE contract_processing SET revision=revision+1 WHERE demand_id=?",did);invalidate(did);
   activeFiles.delete(did);
  }
  // Reuse healthy originals and read at most two known pages, one at a time.
  const pendingPlan=buildProcessingPlan(did);
  let targetedPages=0;
  for(const entry of targetedRecovery(did,ticket.hash,pendingPlan?.comparisons)){
   for(const target of entry.targets){
    if(targetedPages>=2||recoveryPaused()&&!force&&userId===null)break;
    targetedPages++;
    activeFiles.set(did,{documentId:entry.file.document_id,targeted:true,page:target.page});
    const current=one('SELECT extracted,bytes FROM processing_files WHERE id=?',entry.file.id);
    const before=JSON.parse(current.extracted);
    const complementary=/\.pdf$/i.test(entry.file.name)&&process.env.DOCUMENT_DOCLING_ENABLED==='true'?await readDoclingPage(Buffer.from(current.bytes),target.page):null;
    const useful=complementary?.ok&&target.fields.some(key=>complementary.fields[key]?.some(value=>plausibleFieldValue(key,value)));
    const reread=useful?{...complementary,problem:'',needsReview:true}:await readProcessingFile(Buffer.from(current.bytes),entry.file.name,{page:target.page,x:0,y:0,width:1,height:1,rotation:0});
    if(one('SELECT hash FROM glpi_tickets WHERE external_id=?',demand.glpi_id)?.hash!==ticket.hash)return;
    // A confirmation or manual update made while OCR was running wins.
    if(one('SELECT extracted FROM processing_files WHERE id=?',entry.file.id)?.extracted!==current.extracted)continue;
    if(one('SELECT file_id FROM processing_file_reviews WHERE file_id=? AND extraction_hash=?',entry.file.id,sha256(Buffer.from(current.extracted))))continue;
    const merged=JSON.stringify(mergeTargetedReading(before,reread,target));
    run('UPDATE processing_files SET extracted=? WHERE id=?',merged,entry.file.id);
    // Confirmed fields were excluded from targets and their original values/evidence remain intact.
    run('UPDATE processing_field_reviews SET extraction_hash=? WHERE file_id=? AND extraction_hash=?',sha256(Buffer.from(merged)),entry.file.id,sha256(Buffer.from(current.extracted)));
    run('UPDATE contract_processing SET revision=revision+1 WHERE demand_id=?',did);invalidate(did);
    activeFiles.delete(did);
   }
   if(targetedPages>=2)break;
  }
  // Auxiliary extraction never modifies local fields or human reviews. Explicit recheck runs
  // at most two documents, with persistent deduplication and no automatic retry storm.
  if(visionConfig().ready&&userId!==null){
   const plan=buildProcessingPlan(did),keys=(plan?.comparisons||[]).filter(c=>['missing','review'].includes(c.status)).map(c=>c.field);
   let calls=0;
   for(const cached of filesFor(did,ticket.hash)){
    if(calls>=2||!keys.length)break;if(!cached.byteLength||extractionReviewed(cached))continue;
    const reading=JSON.parse(cached.extracted),bytes=Buffer.from(one('SELECT bytes FROM processing_files WHERE id=?',cached.id).bytes);
    if(!shouldReadVision(reading.vision,visionSignature(bytes,keys,visionConfig().model)))continue;
    calls++;const vision=await readWithVision(bytes,cached.name,reading.text||'',keys);
    if(one('SELECT hash FROM glpi_tickets WHERE external_id=?',demand.glpi_id)?.hash!==ticket.hash)return;
    if(vision){run('UPDATE processing_files SET extracted=? WHERE id=?',JSON.stringify({...reading,vision}),cached.id);run('UPDATE contract_processing SET revision=revision+1 WHERE demand_id=?',did);invalidate(did);}
   }
  }
  if(one("SELECT hash FROM glpi_tickets WHERE external_id=?",demand.glpi_id)?.hash===ticket.hash){saveProcessingResult(did);audit(did,userId,"Leitura automática do GLPI e validação do preenchimento concluídas; sem escrita no helpdesk.");}
 }catch(error){lastProcessingError.set(did,failureDetail(error));run("UPDATE contract_processing SET status='Aguardando análise',result=?,updated=? WHERE demand_id=?",JSON.stringify({issues:[{field:"processing",label:"Leitura do chamado",message:"Não foi possível concluir a leitura. Tente novamente."}],values:{},files:[],templates:[]}),now(),did);}
 finally{running.delete(did);activeFiles.delete(did);}
}
let durableQueue:ReadingJobQueue|undefined,draining=false;
const recoveryPaused=()=>one('SELECT value FROM settings WHERE key=?','documentReadingPaused')?.value==='true';
export function processingFileProgress(did:string){
 const {ticket}=processingSource(did);if(!ticket)return {demandId:did,files:[],paused:recoveryPaused()};
 const raw=JSON.parse(ticket.payload),cached=filesFor(did,ticket.hash);
 const queue=one('SELECT state,available_at FROM reading_jobs WHERE demand_id=? AND ticket_hash=?',did,ticket.hash);
 const targets=new Set(targetedRecovery(did,ticket.hash).map(({file})=>file.document_id));
 return {demandId:did,paused:recoveryPaused(),attachmentsUnavailable:raw.documentsAvailable===false,files:(raw.documents||[]).map((doc:any)=>fileProgress(doc,cached.find(f=>f.document_id===String(doc.id)),queue,activeFiles.get(did),targets.has(String(doc.id))))};
}
function targetedRecovery(did:string,hash:string,comparisons?:any[]){
 const pending=comparisons||JSON.parse(one('SELECT result FROM contract_processing WHERE demand_id=?',did)?.result||'{}').comparisons||[];
 return filesFor(did,hash).flatMap(file=>{
  if(!file.byteLength||file.problem)return [];
  const extractedHash=sha256(Buffer.from(file.extracted));
  if(one('SELECT file_id FROM processing_file_reviews WHERE file_id=? AND extraction_hash=?',file.id,extractedHash))return [];
  const protectedFields=all('SELECT field FROM processing_field_reviews WHERE file_id=? AND extraction_hash=?',file.id,extractedHash).map(r=>r.field);
  const reader=/\.pdf$/i.test(file.name)&&process.env.DOCUMENT_DOCLING_ENABLED==='true'&&doclingConfig().ready?'docling':'ocr';
  const targets=targetedReadingTargets(file.name,JSON.parse(file.extracted),pending,protectedFields,reader);
  return targets.length?[{file,targets}]:[];
 });
}
function needsFileRecovery(did:string,hash:string) {
 const cached=filesFor(did,hash),ticket=one('SELECT payload FROM glpi_tickets WHERE external_id=(SELECT glpi_id FROM demands WHERE id=?)',did);
 return (JSON.parse(ticket?.payload||'{}').documents||[]).some((doc:any)=>{
  const file=cached.find(f=>f.document_id===String(doc.id));
  return needsReadingRecovery(file)&&!(file&&extractionReviewed(file))&&!(file&&logoImage(file)&&cached.some(other=>other.id!==file.id&&!other.problem));
 });
}
function needsDemandRecovery(did:string,hash:string) {
 return targetedRecovery(did,hash).length>0||needsFileRecovery(did,hash);
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
export function recoveryReason(did:string,hash:string,ignorePause=false){
 if(!ignorePause&&recoveryPaused())return 'Leitura automática pausada (documentReadingPaused).';
 const cached=filesFor(did,hash),ticket=one('SELECT payload FROM glpi_tickets WHERE external_id=(SELECT glpi_id FROM demands WHERE id=?)',did);
 const reasons=(JSON.parse(ticket?.payload||'{}').documents||[]).flatMap((doc:any)=>{
  const file=cached.find(f=>f.document_id===String(doc.id));
  if(!needsReadingRecovery(file)||file&&extractionReviewed(file)||file&&logoImage(file)&&cached.some(other=>other.id!==file.id&&!other.problem))return [];
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
 const targets=targetedRecovery(did,hash).map(({file,targets})=>`${file.name}: releitura direcionada das páginas ${targets.map(t=>t.page).join(', ')}`);
 return [outer&&'Erro no processamento: '+outer,...reasons,...targets].filter(Boolean).join(' | ')||'Recuperação pendente sem causa identificada';
}
function recoveryProgress(did:string,hash:string){return filesFor(did,hash).reduce((total,f)=>{const e=JSON.parse(f.extracted);return total+(f.byteLength?1:0)+(e.completedPages?.length||0)+Object.keys(e.fields||{}).length;},0);}
async function drainReadingQueue() {
 if(draining||recoveryPaused())return;
 draining=true;
 try {
  while(!recoveryPaused()){
   await yieldToServer();
   const job=durableQueue!.claim();if(!job)break;
   const source=processingSource(job.demand_id);
   if(!source.ticket||source.ticket.hash!==job.ticket_hash||['Concluído','Cancelado','Em assinatura'].includes(source.demand?.stage)){
    durableQueue!.finish(job,'superseded');continue;
   }
   // Tickets ended in GLPI are read only on request. Reopening changes the version and creates a new job.
   if(closedInGlpi(source.ticket.status)){durableQueue!.finish(job,'superseded','Chamado encerrado no GLPI: leitura automática pausada; releitura manual disponível.');continue;}
   try {
    if(running.has(job.demand_id)){durableQueue!.finish(job,'retry','Leitura manual em andamento');continue;}
    const before=recoveryProgress(job.demand_id,job.ticket_hash);
    const cachedIds = new Set(filesFor(job.demand_id, job.ticket_hash).filter(file => file.byteLength).map(file => file.document_id));
    const hasMissingAttachments = (JSON.parse(source.ticket.payload).documents || [])
      .some((doc: {id: string}) => !cachedIds.has(String(doc.id)));
    const targetedOnly=job.last_error==='targeted-fields' && !hasMissingAttachments;
    await processContract(job.demand_id,null,downloadGlpiAttachment,false,targetedOnly);
    const after=recoveryProgress(job.demand_id,job.ticket_hash);
    const current=processingSource(job.demand_id);
    if(current.ticket?.hash!==job.ticket_hash)durableQueue!.finish(job,'superseded');
    else if(targetedOnly?targetedRecovery(job.demand_id,job.ticket_hash).length>0:needsDemandRecovery(job.demand_id,job.ticket_hash)){
     const reason=targetedOnly?'targeted-fields':recoveryReason(job.demand_id,job.ticket_hash);
     durableQueue!.finish(job,'retry',reason,after>before?after:undefined,!targetedOnly&&onlyTemporary(reason));
    }
    else durableQueue!.finish(job,'done','',after>before?after:undefined);
   }catch(error){durableQueue!.finish(job,'retry','Tentativa interrompida; resultados anteriores preservados. '+failureDetail(error));}
  }
 }finally{draining=false;}
}
let scanningRecovery=false;
export function scheduleContractProcessing() {
 if(process.env.NODE_ENV==='test'||recoveryPaused()||scanningRecovery)return;
 scanningRecovery=true;
 void (async()=>{
  durableQueue??=new ReadingJobQueue(db);
  void drainReadingQueue();
  for(const d of all("SELECT d.id,t.status FROM demands d JOIN glpi_tickets t ON t.external_id=d.glpi_id WHERE t.mode='real' AND d.stage NOT IN('Concluído','Cancelado','Em assinatura')")){
   await yieldToServer();
   if(recoveryPaused())break;
   if(running.has(d.id))continue;
   const job=ensureProcessing(d.id);
   if(!job)continue;
   const result=JSON.parse(job.result);
   if(job.status==='Analisando'||result.fingerprint!==fingerprint(d.id))
    saveProcessingResult(d.id);
   if(closedInGlpi(d.status))continue;
   const fileRecovery=needsFileRecovery(d.id,job.ticket_hash),targeted=targetedRecovery(d.id,job.ticket_hash).length>0;
   if(fileRecovery||targeted)durableQueue.enqueue(d.id,job.ticket_hash,targeted&&!fileRecovery,fileRecovery);
  }
  void drainReadingQueue();
 })().catch(error=>console.error("Falha ao verificar a fila de leitura:",failureDetail(error)))
   .finally(()=>{scanningRecovery=false;});
}
export function processingSummary(did:string) {
 const j=one(`SELECT d.stage,t.hash,p.status,p.ticket_hash,p.revision,
  json_array_length(p.result,'$.issues') AS issues,
  CASE WHEN p.status='Aguardando correção' THEN json_extract(p.result,'$.issues') END AS saved_issues,
  CASE WHEN p.status='Aguardando correção' THEN json_extract(p.result,'$.comparisons') END AS saved_comparisons
  FROM demands d JOIN glpi_tickets t ON t.external_id=d.glpi_id AND t.mode='real'
  LEFT JOIN contract_processing p ON p.demand_id=d.id WHERE d.id=?`,did);
 if(!j)return null;
 if(["Concluído","Cancelado","Em assinatura"].includes(j.stage))return {status:j.stage,revision:j.revision||0,issues:0};
 if(j.ticket_hash!==j.hash)return {status:"Analisando",revision:j.revision||0};
 const status=j.status==='Aguardando correção'
  ? processingStatus(JSON.parse(j.saved_issues||'[]'),JSON.parse(j.saved_comparisons||'[]')) : j.status;
 if(status!==j.status)run("UPDATE contract_processing SET status=? WHERE demand_id=?",status,did);
 return {status,revision:j.revision,issues:j.issues||0};
}

