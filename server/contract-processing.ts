import { all,one,run,db,id,now,audit } from "./db.js";
import { downloadGlpiAttachment } from "./glpi-download.js";
import { analyzeTicket,htmlToText,validCnpj } from "./glpi-analysis.js";
import { extractProcessingFile,fieldsFromLines,normalizeValue,inputLabels,norm } from "./processing-extract.js";
import { details } from "./governance.js";
import { listOfficial,sourceOf,homologated,sha256 } from "./official-templates.js";
import { officialRequired,officialProblems,deriveOfficial,derivedFrom } from "../shared/official-fields.js";
import { validateData } from "../shared/data-validation.js";
import { wholeMonths } from "../shared/extenso.js";
import { generate,review } from "./documents.js";
import { readProcessingFile,readerVersion } from "./file-reading.js";
import { invalidate } from "./workflow.js";
export const processingStates=["Analisando","Aguardando análise","Aguardando correção","Pronto para download"];
type Issue={field:string;label:string;message:string;found?:string;expected?:string;source?:string};
const running=new Set<string>();
function fingerprint(did:string) {
 const d=one("SELECT school_id,contract_id,data_version FROM demands WHERE id=?",did);
 return sha256(Buffer.from(JSON.stringify([
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
 const files=all("SELECT * FROM processing_files WHERE demand_id=? ORDER BY rowid DESC",did).filter(f=>f.ticket_hash===hash || f.ticket_hash.startsWith(hash+":correction:"));
 return files.filter((f,i)=>files.findIndex(x=>x.document_id===f.document_id)===i);
}
export function buildProcessingPlan(did:string) {
 const {demand:d,ticket}=processingSource(did),job=one("SELECT * FROM contract_processing WHERE demand_id=?",did);
 if(!d || !ticket || !job)return null;
 const raw=JSON.parse(ticket.payload),analysis=analyzeTicket(raw,{schools:[],matrices:[]});
 const overrides=JSON.parse(job.overrides),values:Record<string,string>={},origins:Record<string,string>={},issues:Issue[]=[];
 const systemLabels:Record<string,string>={template:"Modelo do contrato",templateApproval:"Validação do modelo",history:"Numeração do aditivo",organization:"Organização",files:"Documentos",generation:"Geração do contrato",consistency:"Consistência dos dados"};
 const add=(field:string,message:string,extra:Partial<Issue>={})=>issues.push({field,label:field.startsWith("review:")?"Conferência da leitura":inputLabels[field]||systemLabels[field]||field,message,...extra});
 const request=fieldsFromLines(htmlToText(raw.content)),files=filesFor(did,ticket.hash),candidates:Record<string,{value:string;source:string}[]>={};
 for(const f of files) {
  if(f.problem){add("file:"+f.document_id,f.problem,{source:f.name});continue;}
  const extracted=JSON.parse(f.extracted);
  if(extracted.needsReview && !one("SELECT file_id FROM processing_file_reviews WHERE file_id=? AND extraction_hash=?",f.id,sha256(Buffer.from(f.extracted))))add("review:"+f.id,"Confira o texto extraído com o original e confirme a leitura. OCR e outros leitores podem confundir números ou omitir trechos.",{label:"Conferência de leitura: "+f.name,source:f.name});
  for(const [key,vs] of Object.entries(extracted.fields) as [string,string[]][])for(const value of vs)(candidates[key]||=[]).push({value,source:f.name});
 }
 for(const doc of raw.documents || [])if(!files.some(f=>f.document_id===String(doc.id)))add("file:"+doc.id,"Não foi possível obter este anexo. Tente novamente ou envie uma cópia DOCX.",{source:doc.name});
 if(!raw.documents?.length)add("files","O chamado não contém contrato anexado. É necessário obter o documento.");
 for(const [key,vs] of Object.entries(candidates)) {
  const distinct=vs.map(x=>normalizeValue(key,x.value)).filter((v,i,a)=>a.findIndex(x=>norm(x)===norm(v))===i);
  if(distinct.length===1){values[key]=distinct[0];origins[key]=vs[0].source;}
  else if(!Object.hasOwn(overrides,key))add(key,"Foram encontrados valores diferentes nos documentos. Informe o valor correto.",{found:distinct.join("; "),source:vs.map(x=>x.source).join("; ")});
 }
 for(const [key,vs] of Object.entries(request)) {
  const distinct=[...new Set(vs)];if(distinct.length===1){
   if(values[key] && norm(values[key])!==norm(distinct[0]) && !Object.hasOwn(overrides,key))add(key,"O documento difere do pedido. Corrija o valor para gerar o contrato.",{found:values[key],expected:distinct[0],source:"Formulário GLPI e documento anexado"});
   values[key]=distinct[0];origins[key]="Formulário do chamado GLPI";
  }
 }
 for(const key of ["cnpj","razaoSocial","nomeFantasia","endereco","remuneracao"])if(analysis.fields[key]?.value){
  const value=normalizeValue(key,analysis.fields[key].value);
  if(candidates[key]?.some(c=>norm(normalizeValue(key,c.value))!==norm(value)) && !Object.hasOwn(overrides,key) && !issues.some(i=>i.field===key))add(key,"O valor no anexo difere do solicitado. Confira e salve o valor correto.",{found:candidates[key].map(c=>c.value).join("; "),expected:value,source:analysis.fields[key].origin});
  values[key]=value;origins[key]=analysis.fields[key].origin;
 }
 for(const [key,value]of Object.entries(JSON.parse(d.data)))if(typeof value==="string" && !values[key] && value && inputLabels[key]){values[key]=normalizeValue(key,value);origins[key]="Cadastro local da demanda";}
 for(const [key,value]of Object.entries(overrides))if(typeof value==="string"){values[key]=normalizeValue(key,value);origins[key]="Correção manual no portal";}
 if(!values.modalidade){const named=["Garantia Completa","Garantia Conjunta","Garantia Prevista"].filter(x=>norm(htmlToText(raw.content).join(" ")+" "+raw.title).includes(norm(x)));if(named.length===1){values.modalidade=named[0];origins.modalidade="Modalidade explicitamente citada no chamado GLPI";}}
 if(!values.duracaoMeses && values.inicio && values.fim)try{const months=wholeMonths(values.inicio,values.fim);if(months!==null && months>0){values.duracaoMeses=String(months);origins.duracaoMeses="Calculado a partir das datas exatas de início e fim";}}catch{}
 if(!d.school_id)add("organization","Identifique e cadastre a organização correta antes de gerar o contrato.");
 else {const school=one("SELECT cnpj FROM schools WHERE id=?",d.school_id);if(values.cnpj && school?.cnpj.replace(/\D/g,"")!==values.cnpj.replace(/\D/g,""))add("cnpj","O CNPJ informado difere da organização vinculada à demanda.",{found:values.cnpj,expected:school?.cnpj});}
 const type=analysis.suggestion.type || (d.type!=="A classificar"?d.type:"");
 const subtype=analysis.suggestion.subtype || details(d).subtype || "";
 const templates=listOfficial().filter(t=>!t.inactive && (!type || t.document_type===type) && (t.document_type!=="Aditivo" || !subtype || t.subtype===subtype));
 const eligible=templates.filter(t=>!t.modality || t.modality===values.modalidade);
 let template=job.template_id?templates.find(t=>t.version_id===job.template_id):eligible.length===1?eligible[0]:null;
 if(template?.modality && values.modalidade && template.modality!==values.modalidade)template=null;
 if(!template)add("template",templates.length?"Confirme o modelo correspondente ao pedido.":"Não há modelo cadastrado para este tipo de contrato. Cadastre o modelo correto em Modelos.");
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
 if(values.cnpj && !validCnpj(values.cnpj))add("cnpj","CNPJ com dígitos verificadores inválidos. Confira o documento cadastral.",{found:values.cnpj});
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
 return {demand:d,ticket,job,values,origins,issues,template,templates,version,sequence,matrix,derived,generated,type:actualType,subtype:actualSubtype,
  files:files.map(f=>{const e=JSON.parse(f.extracted);return {id:f.id,document_id:f.document_id,name:f.name,mime:f.mime,problem:f.problem,method:e.method,confidence:e.confidence,pages:e.pages,needsReview:!!e.needsReview && !one("SELECT file_id FROM processing_file_reviews WHERE file_id=? AND extraction_hash=?",f.id,sha256(Buffer.from(f.extracted))),corrected:f.ticket_hash.includes(":correction:"),text:e.text?.slice(0,500000)||""};})};
}
export function saveProcessingResult(did:string) {
 const plan=buildProcessingPlan(did);if(!plan)return null;
 const result={values:plan.values,origins:plan.origins,issues:plan.issues,template:plan.template,templates:plan.templates,files:plan.files,type:plan.type,subtype:plan.subtype,fingerprint:fingerprint(did)};
 const status=plan.issues.some(i=>i.field.startsWith("file:")||i.field.startsWith("review:"))?"Aguardando análise":plan.issues.length?"Aguardando correção":"Pronto para download";
 run("UPDATE contract_processing SET status=?,result=?,updated=? WHERE demand_id=?",status,JSON.stringify(result),now(),did);
 return {status,revision:plan.job.revision,ticket_hash:plan.ticket.hash,...result};
}
export async function processContract(did:string,userId:string|null=null,download=downloadGlpiAttachment,force=false) {
 if(running.has(did))return;const job=ensureProcessing(did);if(!job)return;
 running.add(did);run("UPDATE contract_processing SET status='Analisando',updated=? WHERE demand_id=?",now(),did);
 const {demand,ticket}=processingSource(did);
 try {
  const raw=JSON.parse(ticket.payload);
  for(const doc of (raw.documents||[]).slice(0,20)) {
   const cached=filesFor(did,ticket.hash).find(f=>f.document_id===String(doc.id));
   if(cached && JSON.parse(cached.extracted).version===readerVersion && (!force || !cached.problem))continue;
   let file:any,extracted:any;
   try {file=cached?.bytes.length?{name:cached.name,mime:cached.mime,bytes:Buffer.from(cached.bytes)}:await download(demand.glpi_id,String(doc.id),AbortSignal.timeout(20000));extracted=await readProcessingFile(file.bytes,file.name);}
   catch{file={name:doc.name,mime:doc.mime||"application/octet-stream",bytes:Buffer.alloc(0)};extracted={version:readerVersion,text:"",fields:{},problem:"Não foi possível obter ou ler o anexo. Tente novamente ou envie uma cópia legível."};}
   if(one("SELECT hash FROM glpi_tickets WHERE external_id=?",demand.glpi_id)?.hash!==ticket.hash)return;
   if(cached && cached.bytes.length)run("UPDATE processing_files SET extracted=?,problem=? WHERE id=?",JSON.stringify(extracted),extracted.problem,cached.id);
   else run("INSERT INTO processing_files VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(demand_id,document_id,ticket_hash) DO UPDATE SET name=excluded.name,mime=excluded.mime,bytes=excluded.bytes,extracted=excluded.extracted,problem=excluded.problem,created=excluded.created",id(),did,String(doc.id),ticket.hash,file.name,file.mime,file.bytes,JSON.stringify(extracted),extracted.problem,now());
   run("UPDATE contract_processing SET revision=revision+1 WHERE demand_id=?",did);invalidate(did);
  }
  if(one("SELECT hash FROM glpi_tickets WHERE external_id=?",demand.glpi_id)?.hash===ticket.hash){saveProcessingResult(did);audit(did,userId,"Leitura automática do GLPI e validação do preenchimento concluídas; sem escrita no helpdesk.");}
 }catch{run("UPDATE contract_processing SET status='Aguardando correção',result=?,updated=? WHERE demand_id=?",JSON.stringify({issues:[{field:"processing",label:"Leitura do chamado",message:"Não foi possível concluir a leitura. Tente novamente."}],values:{},files:[],templates:[]}),now(),did);}
 finally{running.delete(did);}
}
let chain=Promise.resolve();
export function scheduleContractProcessing() {
 if(process.env.NODE_ENV==="test")return;
 for(const d of all("SELECT d.id FROM demands d JOIN glpi_tickets t ON t.external_id=d.glpi_id WHERE t.mode='real' AND d.stage NOT IN('Concluído','Cancelado')")) {
  const old=one("SELECT * FROM contract_processing WHERE demand_id=?",d.id),job=ensureProcessing(d.id);
  const outdated=filesFor(d.id,job?.ticket_hash||"").some(f=>JSON.parse(f.extracted).version!==readerVersion);
  if(!job || running.has(d.id) || (!outdated && old && old.ticket_hash===job.ticket_hash && old.status!=="Analisando"))continue;
  run("UPDATE contract_processing SET status='Analisando' WHERE demand_id=?",d.id);
  running.add(d.id);
  chain=chain.then(async()=>{running.delete(d.id);await processContract(d.id);}).catch(()=>{running.delete(d.id);});
 }
}
export function processingSummary(did:string) {
 const {ticket}=processingSource(did);if(!ticket)return null;
 const j=one("SELECT status,ticket_hash,revision,result FROM contract_processing WHERE demand_id=?",did);
 if(!j || j.ticket_hash!==ticket.hash)return {status:"Analisando",revision:j?.revision||0};
 const result=JSON.parse(j.result);
 if(j.status!=="Analisando" && result.fingerprint!==fingerprint(did)){const updated=saveProcessingResult(did);if(updated)return {status:updated.status,revision:updated.revision,issues:updated.issues.length};}
 return {status:j.status,revision:j.revision,issues:result.issues?.length||0};
}
