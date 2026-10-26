import type { Express } from "express";
import multer from "multer";
import { z } from "zod";
import { all,one,run,db,id,now,audit } from "./db.js";
import { access,permit,allocateAddendum,invalidate } from "./workflow.js";
import { ensureProcessing,processContract,processingSource,saveProcessingResult,buildProcessingPlan } from "./contract-processing.js";
import { editableKeys,extractProcessingFile } from "./processing-extract.js";
import { sha256,officialValues } from "./official-templates.js";
import { generate,review } from "./documents.js";
import { readProcessingFile,supportedReading } from "./file-reading.js";
import sharp from "sharp";
import { prepareImage } from "./image-input.js";
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
 app.get("/api/demands/:id/processing",(req:any,res)=>{get(req);res.json(processingView(req.params.id));});
 app.post("/api/demands/:id/processing/recheck",async(req:any,res)=>{get(req,true);await process(req.params.id,req.user.id,undefined,true);res.json(processingView(req.params.id));});
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
   if(!supportedReading.test(req.file.originalname))throw Error("Envie PDF, imagem, Word, ODT, XLSX, PPTX, TXT ou CSV de até 20 MB.");
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
