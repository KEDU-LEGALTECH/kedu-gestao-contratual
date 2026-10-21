import type { Express } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { one, all, run, id, now, audit, db } from "./db.js";
import { access, permit, invalidate } from "./workflow.js";
import { downloadGlpiAttachment } from "./glpi-download.js";
import { inspectAttachment, attachmentFields } from "./attachment-analysis.js";
import { validateData } from "../shared/data-validation.js";
const upload = multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1}});
function get(req:any) {
  permit(req.user,"files"); permit(req.user,"bank");
  const d=one("SELECT * FROM demands WHERE id=?",req.params.id);
  if(!d) throw Error("Demanda não encontrada."); access(req.user,d);return d;
}
export function attachmentChecks(d:any,user:any) {
  if(!["Administrador","Operação","Jurídico","Risco","Financeiro","Aprovador"].includes(user.role))return [];
  return all("SELECT id,document_id,name,status,findings,expected,reference,parent_id,author,created,data_version,ticket_hash FROM attachment_checks WHERE demand_id=? ORDER BY rowid DESC",d.id).map(c=>({...c,findings:JSON.parse(c.findings),expected:JSON.parse(c.expected),stale:c.data_version!==d.data_version || c.ticket_hash!==one("SELECT hash FROM glpi_tickets WHERE external_id=?",d.glpi_id)?.hash}));
}
export function registerAttachmentRoutes(app:Express,download:(ticket:string,document:string,signal:AbortSignal)=>Promise<{bytes:Buffer;name:string;mime:string}>=downloadGlpiAttachment) {
  app.post("/api/demands/:id/attachment-checks",rateLimit({windowMs:60000,limit:10}),(req:any,_res,next)=>{get(req);permit(req.user,"write");permit(req.user,"review");next();},upload.single("file"),async(req:any,res)=>{
    const d=get(req);
    if(["Concluído","Cancelado","Em assinatura"].includes(d.stage))throw Error("Demanda encerrada ou em assinatura não permite analisar nova versão.");
    const b=z.object({document_id:z.string().regex(/^\d+$/),expected_version:z.coerce.number().int(),expected_hash:z.string().min(1),reference:z.string().trim().min(10).max(500),expected:z.string(),attested:z.literal("true"),parent_id:z.string().optional()}).parse(req.body);
    const ticket=one("SELECT * FROM glpi_tickets WHERE external_id=? AND mode='real'",d.glpi_id);
    if(!ticket || !JSON.parse(ticket.payload).documents.some((x:any)=>String(x.id)===b.document_id))throw Error("Selecione um anexo do chamado vinculado à demanda.");
    const expected=z.record(z.string(),z.string().trim().max(100)).parse(JSON.parse(b.expected));
    if(!Object.keys(expected).length || Object.keys(expected).some(k=>!attachmentFields[k] || !expected[k]))throw Error("Informe ao menos um campo suportado e seu valor esperado.");
    const errors=validateData(expected);if(Object.keys(errors).length)throw Object.assign(Error("Corrija os valores esperados: "+Object.entries(errors).map(([k,v])=>(attachmentFields[k]||k)+": "+v).join("; ")),{fields:errors});
    const parent=b.parent_id ? one("SELECT * FROM attachment_checks WHERE id=? AND demand_id=? AND document_id=?",b.parent_id,d.id,b.document_id):null;
    if(b.parent_id && !parent)throw Error("Conferência anterior inválida para este anexo.");
    if(req.file && !parent)throw Error("Para corrigir, selecione a conferência original do anexo.");
    if(b.expected_version!==d.data_version || b.expected_hash!==ticket.hash)throw Object.assign(Error("Demanda ou chamado mudou. Reabra antes de analisar."),{status:409});
    let file;
    if(req.file) {
      if(!/\.docx$/i.test(req.file.originalname))throw Error("Envie a versão corrigida em DOCX de até 5 MB.");
      file={name:req.file.originalname.replace(/[\r\n\\/]/g,"_").slice(0,180),mime:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",bytes:req.file.buffer};
    } else file=await download(d.glpi_id,b.document_id,AbortSignal.timeout(60000));
    const checked=inspectAttachment(file.bytes,file.name,expected),cid=id();
    db.exec("BEGIN IMMEDIATE");
    try {
      const fresh=one("SELECT data_version,stage FROM demands WHERE id=?",d.id);
      if(fresh.data_version!==d.data_version || fresh.stage!==d.stage || one("SELECT hash FROM glpi_tickets WHERE external_id=?",d.glpi_id).hash!==ticket.hash)throw Object.assign(Error("Demanda ou chamado mudou durante a leitura. Reabra e tente novamente."),{status:409});
      run("INSERT INTO attachment_checks VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",cid,d.id,b.document_id,ticket.hash,d.data_version,file.name,file.mime,file.bytes,checked.text,JSON.stringify(expected),b.reference,JSON.stringify(checked.findings),checked.status,parent?.id||null,req.user.id,now());
      const pending=one("SELECT demand_id FROM glpi_intakes WHERE demand_id=? AND confirmed_at IS NULL",d.id);
      if(!pending && checked.status!=="conforme") { invalidate(d.id);run("UPDATE demands SET stage=?,confirmed=0 WHERE id=?",checked.status==="divergente"?"Devolvido":"Aguardando informações",d.id); }
      audit(d.id,req.user.id,`Conferência de valores do anexo GLPI ${b.document_id}: ${checked.status}; fonte declarada: ${b.reference}. Não substitui conferência contratual humana.`);
      db.exec("COMMIT");
    }catch(e){db.exec("ROLLBACK");throw e;}
    res.json({id:cid,status:checked.status});
  });
  app.get("/api/demands/:id/attachment-checks/:check/:format",(req:any,res)=>{
    const d=get(req),c=one("SELECT * FROM attachment_checks WHERE id=? AND demand_id=?",req.params.check,d.id);
    if(!c)throw Error("Conferência não encontrada.");
    res.setHeader("Cache-Control","no-store");
    if(req.params.format==="preview")return res.json({name:c.name,text:c.text,findings:JSON.parse(c.findings),status:c.status});
    if(req.params.format!=="download")throw Error("Formato inválido.");
    audit(d.id,req.user.id,"Download da versão de anexo conferida "+c.id);
    res.type(c.mime).attachment(c.name).send(Buffer.from(c.bytes));
  });
}
