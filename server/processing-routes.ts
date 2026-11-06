import type { Express } from "express";
import multer from "multer";
import { z } from "zod";
import { all,one,run,db,id,now,audit } from "./db.js";
import { access,permit,allocateAddendum,invalidate } from "./workflow.js";
import { ensureProcessing,processContract,processingSource,saveProcessingResult,buildProcessingPlan,processingFileProgress,resolutionSignature } from "./contract-processing.js";
import {plausibleFieldValue} from "./field-plausibility.js";
import { editableKeys,extractProcessingFile,normalizeValue } from "./processing-extract.js";
import { sha256,officialValues } from "./official-templates.js";
import { generate,review } from "./documents.js";
import { readProcessingFile,supportedReading } from "./file-reading.js";
import sharp from "sharp";
import { prepareImage } from "./image-input.js";
import {processingSummaryReport} from './processing-summary.js';
import {readingFilename} from './reading-format.js';
import {recordReadingGold} from './reading-gold.js';
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:20*1024*1024,files:1}});
const snapshot=(values:Record<string,string>)=>JSON.stringify(Object.fromEntries(Object.entries(values).sort(([a],[b])=>a.localeCompare(b))));
function get(req:any,write=false) {
 permit(req.user,"files");permit(req.user,"bank");if(write)permit(req.user,"write");
 const {demand,ticket}=processingSource(req.params.id);
 if(!demand || !ticket)throw Object.assign(Error("Esta demanda não possui chamado real do GLPI vinculado."),{status:404});
 access(req.user,demand);if(write && ["Concluído","Cancelado","Em assinatura"].includes(demand.stage))throw Error("Demanda encerrada ou em assinatura não permite alterações.");
 return {demand,ticket};
}
export function processingView(did:string) {
 const job=ensureProcessing(did);if(!job)return null;
 if(job.status!=="Analisando")return saveProcessingResult(did);
 return {status:"Analisando",revision:job.revision,ticket_hash:job.ticket_hash,issues:[],values:{},files:[],templates:[]};
}
export function registerProcessingRoutes(app:Express,process:(did:string,userId?:string|null,download?:any,force?:boolean)=>Promise<any>=processContract) {
 app.get('/api/processing/progress',(req:any,res)=>{
  permit(req.user,'files');permit(req.user,'bank');
  const ids=new Set(z.string().max(100000).parse(req.query.ids).split(',').filter(Boolean));
  const demands=[];
  for(const d of all('SELECT * FROM demands')){
   if(!ids.has(d.id))continue;
   try{access(req.user,d);}catch(error:any){if(error.status===403)continue;throw error;}
   demands.push(processingFileProgress(d.id));
  }
  const files=demands.flatMap(d=>d.files.map((f:any)=>({...f,demandId:d.demandId})));
  const counts={queued:0,running:0,completed:0,failed:0,waiting:0};
  for(const file of files)counts[file.state as keyof typeof counts]++;
  res.setHeader('Cache-Control','no-store');res.json({counts,total:files.length,paused:demands.some(d=>d.paused),attachmentsUnavailable:demands.filter(d=>d.attachmentsUnavailable).length,files,updatedAt:now()});
 });
 app.get('/api/processing/summary',(req:any,res)=>{
  permit(req.user,'files');permit(req.user,'bank');
  const stage=z.enum(['Aguardando análise','Aguardando correção']).parse(req.query.stage);
  const ids=z.string().max(100000).parse(req.query.ids).split(',');
  const selected=new Set(ids),rows=[];
  for(const d of all('SELECT d.*,s.name AS school FROM demands d LEFT JOIN schools s ON s.id=d.school_id ORDER BY d.glpi_id DESC,d.id')){
   if(!selected.has(d.id))continue;
   try{access(req.user,d);}catch(error:any){if(error.status===403)continue;throw error;}
   const plan=d.glpi_id?processingView(d.id):null;
   const status=plan?.status||d.stage;
   if(status===stage)rows.push({...d,status,school:d.school||'Organização não informada',issues:plan?.issues||[]});
  }
  res.setHeader('Cache-Control','no-store');res.json(processingSummaryReport(stage,rows));
 });
 app.post('/api/demands/:id/processing/files/:file/region',async(req:any,res)=>{
  const {demand:d}=get(req,true);
  const body=z.object({revision:z.number().int(),region:z.object({page:z.number().int().min(1).max(200),x:z.number().min(0).max(1),y:z.number().min(0).max(1),width:z.number().min(.02).max(1),height:z.number().min(.02).max(1),rotation:z.union([z.literal(0),z.literal(90),z.literal(180),z.literal(270)])})}).parse(req.body);
  const current=processingView(d.id),file=one('SELECT * FROM processing_files WHERE id=? AND demand_id=?',req.params.file,d.id);
  if(!file?.bytes?.length||!current?.files?.some((f:any)=>f.id===file.id))throw Object.assign(Error('Arquivo não disponível nesta versão.'),{status:404});
  if(current.revision!==body.revision||current.status==='Analisando')throw Object.assign(Error('A demanda mudou. Atualize a página.'),{status:409});
  const hash=current.ticket_hash,reading=await readProcessingFile(Buffer.from(file.bytes),file.name,body.region);
  const latest=processingView(d.id);
  if(latest?.revision!==body.revision||latest?.ticket_hash!==hash)throw Object.assign(Error('A demanda mudou durante a leitura. Tente novamente.'),{status:409});
  res.json(reading);
 });
 app.get("/api/demands/:id/processing",(req:any,res)=>{get(req);res.json(processingView(req.params.id));});
 app.post("/api/demands/:id/processing/recheck",async(req:any,res)=>{get(req,true);await process(req.params.id,req.user.id,undefined,true);res.json(processingView(req.params.id));});
 app.post('/api/demands/:id/processing/files/:file/fields/:field/confirm',(req:any,res)=>{
  const {demand:d}=get(req,true),body=z.object({revision:z.number().int().min(1),value:z.string().min(1).max(500),confirmed:z.literal(true)}).parse(req.body);
  db.exec('BEGIN IMMEDIATE');try{
   const plan=buildProcessingPlan(d.id);
   if(!plan||plan.job.status==='Analisando'||plan.job.revision!==body.revision||plan.job.ticket_hash!==plan.ticket.hash)throw Object.assign(Error('A leitura mudou. Reabra a demanda.'),{status:409});
   const current=plan.files.find(f=>f.id===req.params.file),field=current?.fieldReviews.find(f=>f.key===req.params.field);
   if(!current||current.incomplete||current.problem||!current.available||!field||field.values.length!==1||field.values[0]!==body.value||field.confirmed)throw Object.assign(Error('Campo indisponível, ambíguo ou já conferido. Corrija a leitura antes de confirmar.'),{status:409});
   const file=one('SELECT extracted FROM processing_files WHERE id=? AND demand_id=?',current.id,d.id);
   run('INSERT INTO processing_field_reviews VALUES(?,?,?,?,?,?) ON CONFLICT(file_id,field) DO UPDATE SET extraction_hash=excluded.extraction_hash,value=excluded.value,author=excluded.author,created=excluded.created',current.id,field.key,sha256(Buffer.from(file.extracted)),body.value,req.user.id,now());
   recordReadingGold(current.id,field.key,body.value,sha256(Buffer.from(file.extracted)),req.user.id,field.excerpt||'Conferido pelo usuário no original.');
   run('UPDATE contract_processing SET revision=revision+1 WHERE demand_id=?',d.id);invalidate(d.id);
   audit(d.id,req.user.id,'Campo conferido com o original: '+field.label+' — '+current.name+'. Não constitui aprovação jurídica.');
   saveProcessingResult(d.id);db.exec('COMMIT');res.json(processingView(d.id));
  }catch(error){db.exec('ROLLBACK');throw error;}
 });
 app.post('/api/demands/:id/processing/files/:file/fields/:field/correct-reading',(req:any,res)=>{
  const {demand:d}=get(req,true);
  const body=z.object({revision:z.number().int().min(1),value:z.string().trim().min(1).max(500),evidence:z.string().trim().min(5).max(2000),confirmed:z.literal(true)}).parse(req.body);
  if(!editableKeys.includes(req.params.field))throw Error('Campo de leitura não permitido.');
  const compact=(s:string)=>s.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const value=normalizeValue(req.params.field,body.value);
  if(!value||!compact(value)||!compact(body.evidence).includes(compact(value)))throw Error('Transcreva o trecho do original que contém o valor informado.');
  db.exec('BEGIN IMMEDIATE');try {
   const plan=buildProcessingPlan(d.id),file=one('SELECT * FROM processing_files WHERE id=? AND demand_id=?',req.params.file,d.id);
   if(!plan||plan.job.status==='Analisando'||plan.job.revision!==body.revision||!plan.files.some(f=>f.id===file?.id)||!file?.bytes?.length)throw Object.assign(Error('O documento mudou ou está indisponível. Atualize a página.'),{status:409});
   const reading=JSON.parse(file.extracted);
   if(reading.incomplete||file.problem)throw Error('Conclua a leitura do arquivo antes de corrigir um campo.');
   reading.fields[req.params.field]=[value];
   const extracted=JSON.stringify(reading),hash=sha256(Buffer.from(extracted));
   run('UPDATE processing_files SET extracted=? WHERE id=?',extracted,file.id);
   run('INSERT INTO processing_field_reviews VALUES(?,?,?,?,?,?) ON CONFLICT(file_id,field) DO UPDATE SET extraction_hash=excluded.extraction_hash,value=excluded.value,author=excluded.author,created=excluded.created',file.id,req.params.field,hash,value,req.user.id,now());
   recordReadingGold(file.id,req.params.field,value,hash,req.user.id,body.evidence);
   run('UPDATE contract_processing SET revision=revision+1 WHERE demand_id=?',d.id);invalidate(d.id);
   audit(d.id,req.user.id,'Transcrição de campo corrigida e conferida no original; gabarito registrado. Arquivo original preservado.');
   saveProcessingResult(d.id);db.exec('COMMIT');res.json(processingView(d.id));
  }catch(error){db.exec('ROLLBACK');throw error;}
 });
 // Human decisions the reader cannot make: which reference applies and why a finding is acceptable.
 app.post('/api/demands/:id/processing/resolutions',(req:any,res)=>{
  const {demand:d}=get(req,true);
  const body=z.object({revision:z.number().int().min(1),kind:z.enum(['reference','validation']),field:z.string().min(1).max(60),value:z.string().trim().max(500).optional(),note:z.string().trim().min(5).max(1000),confirmed:z.literal(true)}).parse(req.body);
  db.exec('BEGIN IMMEDIATE');try{
   const plan=buildProcessingPlan(d.id);
   if(!plan||plan.job.status==='Analisando'||plan.job.revision!==body.revision||plan.job.ticket_hash!==plan.ticket.hash)throw Object.assign(Error('A análise mudou. Reabra a demanda.'),{status:409});
   let signature:string,value='',label:string;
   if(body.kind==='reference'){
    const row=plan.comparisons.find((c:any)=>c.field===body.field&&c.status==='ambiguous');
    if(!row)throw Object.assign(Error('Esta referência não está pendente.'),{status:409});
    value=normalizeValue(body.field,body.value||'');
    if(!value)throw Error('Informe o valor correto da referência.');
    if(['cnpj','representanteCpf','documentoTitular'].includes(body.field)&&!plausibleFieldValue(body.field,value))throw Error('O documento informado tem dígitos verificadores inválidos.');
    signature=resolutionSignature(body.field,row.expected);label='Referência do chamado definida: '+row.label;
   }else{
    const finding=plan.validationFindings.find((f:any)=>f.field===body.field&&!f.resolution);
    if(!finding)throw Object.assign(Error('Este achado não está pendente.'),{status:409});
    signature=resolutionSignature(body.field,finding.found);label='Achado de validação conferido: '+body.field;
   }
   run('INSERT INTO processing_resolutions VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(demand_id,kind,field) DO UPDATE SET signature=excluded.signature,value=excluded.value,note=excluded.note,author=excluded.author,created=excluded.created',d.id,body.kind,body.field,signature,value,body.note,req.user.id,now());
   run('UPDATE contract_processing SET revision=revision+1 WHERE demand_id=?',d.id);invalidate(d.id);
   audit(d.id,req.user.id,label+'. Justificativa: '+body.note+'. Não constitui aprovação jurídica.');
   saveProcessingResult(d.id);db.exec('COMMIT');res.json(processingView(d.id));
  }catch(error){db.exec('ROLLBACK');throw error;}
 });
 app.post("/api/demands/:id/processing/files/:file/confirm",(req:any,res)=>{
  const {demand:d}=get(req,true),b=z.object({revision:z.number().int().min(1),confirmed:z.literal(true)}).parse(req.body);
  db.exec("BEGIN IMMEDIATE");
  try {
   const plan=buildProcessingPlan(d.id);
   if(!plan || plan.job.status==="Analisando" || plan.job.revision!==b.revision || plan.job.ticket_hash!==plan.ticket.hash)throw Object.assign(Error("A leitura mudou. Reabra o documento antes de confirmar."),{status:409});
   const current=plan.files.find(f=>f.id===req.params.file),file=current && one("SELECT * FROM processing_files WHERE id=? AND demand_id=?",current.id,d.id);
   if(file && JSON.parse(file.extracted).incomplete)throw Error('A leitura está incompleta. Envie o documento dividido em partes ou uma cópia com texto acessível antes de confirmar.');
   if(!file || file.problem || !current.needsReview || !current.text)throw Object.assign(Error("Este arquivo não está disponível para confirmação de leitura."),{status:409});
   run("INSERT INTO processing_file_reviews VALUES(?,?,?,?) ON CONFLICT(file_id) DO UPDATE SET extraction_hash=excluded.extraction_hash,author=excluded.author,created=excluded.created",file.id,sha256(Buffer.from(file.extracted)),req.user.id,now());
   for(const field of current.fieldReviews)if(field.values.length===1)recordReadingGold(file.id,field.key,field.values[0],sha256(Buffer.from(file.extracted)),req.user.id,field.excerpt||'Leitura completa conferida pelo usuário no original.');
   run("UPDATE contract_processing SET revision=revision+1 WHERE demand_id=?",d.id);invalidate(d.id);
   audit(d.id,req.user.id,"Texto extraído conferido com o original: "+file.name+". Não constitui aprovação jurídica.");
   saveProcessingResult(d.id);db.exec("COMMIT");
  }catch(e){db.exec("ROLLBACK");throw e;}
  res.json(processingView(d.id));
 });
 app.post("/api/demands/:id/processing/preview",(req:any,res)=>{
  const {demand:d}=get(req,true),plan=buildProcessingPlan(d.id);
  if(!plan?.version)throw Error("Selecione o modelo correspondente antes de gerar a prévia.");
  const preview=officialValues({...d,type:plan.type,data:JSON.stringify(plan.values)},plan.values,plan.version,"preview");
  const bytes=generate(Buffer.from(plan.version.bytes),preview.values),previewId=id();
  run("INSERT INTO template_previews VALUES(?,?,?,?,?,?,?,?)",previewId,d.id,plan.version.id,d.data_version,JSON.stringify(preview.values),bytes,req.user.id,now());
  audit(d.id,req.user.id,"Prévia do modelo para homologação; não é contrato liberado para assinatura.");
  res.json({id:previewId,url:`/api/previews/${previewId}/download`});
 });
 app.post("/api/demands/:id/processing/correct",(req:any,_res,next)=>{get(req,true);next();},upload.single("file"),async(req:any,res)=>{
  const {demand:d,ticket}=get(req,true),job=ensureProcessing(d.id);
  const b=z.object({revision:z.coerce.number().int().min(1),values:z.string(),template_id:z.string().optional(),document_id:z.string().optional()}).parse(req.body);
  if(job.status==="Analisando" || job.revision!==b.revision || job.ticket_hash!==ticket.hash)throw Object.assign(Error("A análise mudou. Reabra a demanda antes de corrigir."),{status:409});
  const values=z.record(z.string(),z.string().trim().max(500)).parse(JSON.parse(b.values));
  if(Object.keys(values).some(k=>!editableKeys.includes(k)))throw Error("Campo de correção não autorizado.");
  let file:any=null;
  if(req.file){
   if(!supportedReading.test(readingFilename(req.file.buffer,req.file.originalname)))throw Error("Envie PDF, imagem, Word, ODT, XLSX, PPTX, TXT ou CSV de até 20 MB.");
   if(!JSON.parse(ticket.payload).documents.some((x:any)=>String(x.id)===b.document_id))throw Error("Selecione qual anexo está sendo corrigido.");
   const extracted=await readProcessingFile(req.file.buffer,req.file.originalname);
   if(extracted.problem)throw Error(extracted.problem);
   file={name:req.file.originalname.replace(/[\r\n\\/]/g,"_").slice(0,180),extracted};
  }
  get(req,true);
  db.exec("BEGIN IMMEDIATE");
  try {
   const latest=ensureProcessing(d.id);
   if(latest.revision!==b.revision || latest.ticket_hash!==ticket.hash || latest.status==="Analisando")throw Object.assign(Error("A análise mudou durante a leitura. Reabra a demanda."),{status:409});
   if(file)run("INSERT INTO processing_files VALUES(?,?,?,?,?,?,?,?,?,?)",id(),d.id,b.document_id,ticket.hash+":correction:"+id(),file.name,req.file.mimetype||"application/octet-stream",req.file.buffer,JSON.stringify(file.extracted),"",now());
   const changed=run("UPDATE contract_processing SET overrides=?,template_id=?,revision=revision+1,updated=? WHERE demand_id=? AND revision=?",JSON.stringify({...JSON.parse(job.overrides),...values}),b.template_id||job.template_id,now(),d.id,b.revision);
   if(!changed.changes)throw Error("Conflito de edição. Reabra a demanda.");
   invalidate(d.id);
   audit(d.id,req.user.id,"Correção manual do preenchimento: "+Object.keys(values).join(", ")+(file?"; nova cópia do documento preservada":"")+". Não constitui aprovação jurídica.");
   saveProcessingResult(d.id);db.exec("COMMIT");
  }catch(e){db.exec("ROLLBACK");throw e;}
  res.json(processingView(d.id));
 });
 app.post("/api/demands/:id/processing/export",(req:any,res)=>{
  const {demand:d}=get(req,true);
  const b=z.object({revision:z.number().int().min(1)}).parse(req.body);
  db.exec("BEGIN IMMEDIATE");
  let outputId:string;
  try {
   const plan=buildProcessingPlan(d.id);
   if(!plan || plan.job.revision!==b.revision || plan.job.ticket_hash!==plan.ticket.hash || plan.job.status==="Analisando")throw Object.assign(Error("Análise desatualizada. Reabra a demanda."),{status:409});
   if(plan.issues.length || !plan.generated || !plan.version)throw Object.assign(Error("O contrato ainda possui pendências. Corrija antes de baixar."),{status:409});
   const hash=sha256(Buffer.from(plan.version.bytes));
   let contractId=d.contract_id;
   if(plan.type==="Aditivo") {
    const own=one("SELECT * FROM contracts WHERE id=?",contractId);
    if(own?.parent_id!==plan.matrix.id) {
     const allocated=allocateAddendum(d.school_id,plan.matrix.id,false);contractId=allocated.id;
     if(allocated.sequence!==plan.sequence)throw Error("A numeração mudou. Reabra a demanda para conferir.");
    }
   } else if(!contractId){contractId=id();run("INSERT INTO contracts(id,school_id) VALUES(?,?)",contractId,d.school_id);}
   const previous=one("SELECT * FROM processing_exports WHERE demand_id=? AND revision=? AND ticket_hash=? AND template_id=? AND template_hash=? ORDER BY rowid DESC LIMIT 1",d.id,plan.job.revision,plan.ticket.hash,plan.version.id,hash);
   if(previous && previous.snapshot===snapshot(plan.derived))outputId=previous.id;
   else {
    outputId=id();
    run("INSERT INTO processing_exports VALUES(?,?,?,?,?,?,?,?,?,?)",outputId,d.id,plan.job.revision,plan.ticket.hash,plan.version.id,hash,snapshot(plan.derived),plan.generated,req.user.id,now());
    run("UPDATE demands SET contract_id=?,type=?,data=?,data_version=data_version+1,confirmed=0 WHERE id=?",contractId,plan.type,JSON.stringify({...JSON.parse(d.data),...plan.values}),d.id);
    invalidate(d.id);
    audit(d.id,req.user.id,"Contrato gerado no modelo "+plan.template.name+" após validação de preenchimento; revisão jurídica/assinatura não automáticas.");
   }
   db.exec("COMMIT");
  }catch(e){db.exec("ROLLBACK");throw e;}
  res.json({id:outputId,url:`/api/demands/${d.id}/processing/exports/${outputId}`});
 });
 app.get("/api/demands/:id/processing/exports/:export",(req:any,res)=>{
  const {demand:d}=get(req),file=one("SELECT * FROM processing_exports WHERE id=? AND demand_id=?",req.params.export,d.id),plan=buildProcessingPlan(d.id);
  if(!file || !plan || plan.issues.length || plan.job.status==="Analisando" || plan.job.revision!==file.revision || plan.ticket.hash!==file.ticket_hash || !plan.version || plan.version.id!==file.template_id || sha256(Buffer.from(plan.version.bytes))!==file.template_hash || snapshot(plan.derived)!==file.snapshot)throw Object.assign(Error("O documento está desatualizado ou possui pendências. Reabra a demanda para validar."),{status:409});
  audit(d.id,req.user.id,"Download do contrato com preenchimento validado: "+file.id);
  res.setHeader("Cache-Control","no-store");res.type("application/vnd.openxmlformats-officedocument.wordprocessingml.document").attachment("Contrato-"+d.id+".docx").send(Buffer.from(file.bytes));
 });
 app.get("/api/demands/:id/processing/files/:file",(req:any,res)=>{
  const {demand:d}=get(req),file=one("SELECT * FROM processing_files WHERE id=? AND demand_id=?",req.params.file,d.id);
  if(!file || !file.bytes.length)throw Error("Arquivo não disponível.");
  res.setHeader("Cache-Control","no-store");res.type(file.mime).attachment(file.name).send(Buffer.from(file.bytes));
 });
 app.get("/api/demands/:id/processing/files/:file/view",async(req:any,res)=>{
  const {demand:d}=get(req),file=one("SELECT * FROM processing_files WHERE id=? AND demand_id=?",req.params.file,d.id);
  if(!file || !file.bytes.length)throw Object.assign(Error("Arquivo não disponível."),{status:404});
  const bytes=Buffer.from(file.bytes);
  const mime=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?"image/png":bytes[0]===255 && bytes[1]===216 && bytes[2]===255?"image/jpeg":bytes.subarray(0,5).toString()==="%PDF-"?"application/pdf":null;
  if(!mime){
   if(!/\.(webp|gif|tiff?|bmp)$/i.test(file.name))throw Object.assign(Error("Use a visualização de texto ou baixe o original deste documento."),{status:415});
   const preview=await sharp(await prepareImage(bytes),{limitInputPixels:24000000,page:0,pages:1}).resize({width:3200,height:3200,fit:"inside",withoutEnlargement:true}).png().toBuffer();
   res.setHeader("Cache-Control","no-store");res.setHeader("X-Content-Type-Options","nosniff");res.setHeader("Content-Disposition","inline");res.type("image/png").send(preview);return;
  }
  res.setHeader("Cache-Control","no-store");res.setHeader("X-Content-Type-Options","nosniff");res.setHeader("Content-Disposition","inline");res.type(mime).send(bytes);
 });
}
