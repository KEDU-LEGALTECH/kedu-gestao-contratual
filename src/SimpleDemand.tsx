import { GlpiConversation } from "./GlpiConversation";
import { useEffect,useState } from "react";
import {receivedDocumentKind} from '../shared/document-heading';
import { Download,RefreshCw,ArrowLeft,CheckCircle2,AlertCircle } from "lucide-react";
import { MatrixImport } from "./MatrixImport";
import { SignedHistoryPanel } from "./GovernancePanel";
import { fieldLabels } from "../shared/official-fields";
import { ReceivedDocuments } from "./ReceivedDocuments";
import { RequestComparison } from "./RequestComparison";
import { ProcessingProgress } from './ProcessingProgress';
import { DemandReport } from './DemandReport';
import { FinalizeDemand } from './FinalizeDemand';
const baseLabels:Record<string,string>={...fieldLabels,modalidade:"Modalidade de garantia",endereco:"Endereço",matriz:"Contrato matriz",motivo:"Descrição da solicitação"};
const dateKeys=["inicio","fim","dataAssinaturaMatriz","dataFormalizacao"];
/** A secondary section of the demand, closed until someone needs it. */
function Fold({title,hint,open=false,children}:{title:string;hint?:string;open?:boolean;children:any}){
 return <details className="panel fold" open={open}><summary><strong>{title}</strong>{hint&&<small>{hint}</small>}</summary>{children}</details>;
}
export function SimpleDemand({detail,data,can,api,action,busy,onBack,onAdvanced,onModels}:any) {
 const [job,setJob]=useState<any>(detail.processing),[message,setMessage]=useState("");
 const labels:Record<string,string>={...baseLabels,...(job?.type==="Parcelamento"?{valor:"Valor parcelado",parcelas:"Quantidade de parcelas"}:{})};
 const [manual,setManual]=useState(false);
 useEffect(()=>{setJob(detail.processing);},[detail.processing]);
 useEffect(()=>{
  if(job?.status!=="Analisando" || !can("files") || !can("bank"))return;
  const timer=setInterval(()=>{api(`/demands/${detail.id}/processing`).then(setJob).catch((e:any)=>setMessage(e.message));},2500);
  return()=>clearInterval(timer);
 },[job?.status,detail.id]);
 const ready=job?.status==="Sem erros",analyzing=job?.status==="Analisando",partial=job?.status==="Conferência parcial";
 const readingFiles=(job?.files||[]).filter((file:any)=>file.readingScope!=='support');
 const counts={errors:(job?.comparisons||[]).filter((r:any)=>r.status==='different').length,pending:(job?.comparisons||[]).filter((r:any)=>['missing','review','ambiguous'].includes(r.status)).length};
 const title=(data.organizations||data.schools).find((s:any)=>s.id===detail.school_id)?.name || detail.data.razaoSocial || "Contrato recebido";
 const compared=new Set((job?.comparisons||[]).map((r:any)=>r.field));
 const issues=(job?.issues||[]).filter((i:any)=>compared.has(i.field)||/^(file:|review:|files$|contractMissing$|processing$)/.test(i.field)),allKeys=[...new Set<string>(issues.map((i:any)=>i.field).filter((k:string)=>!!labels[k] && k!=="aditivo"))];
 const missingContract=issues.find((i:any)=>i.field==="contractMissing");
 const unidentifiedContract=issues.find((i:any)=>i.label==="Tipo a confirmar");
 const unreadableContract=issues.find((i:any)=>i.label==="Contrato não lido");
 const matrices=data.contracts.filter((c:any)=>c.school_id===detail.school_id && c.instrument_kind==="Matriz" && c.status==="Assinado");
 const filesProblem=issues.some((i:any)=>i.field.startsWith("file:")||i.field.startsWith("review:"));
 const keys=allKeys.filter(key=>!filesProblem || manual || issues.some((i:any)=>i.field===key && (i.found || i.expected)));
 return <>
  <button className="back" onClick={onBack}><ArrowLeft size={16}/> Voltar para Demandas</button>
  <div className="page-heading"><div><span className="eyebrow">{detail.id}{detail.glpi_id?` · GLPI #${detail.glpi_id}`:" · Demanda de teste/manual"}</span><h1>{title}</h1></div><span className={"badge "+(ready?"conference-clean":job?.status==="Aguardando correção"?"conference-correction":"conference-analysis")}>{job?.status || "Demanda manual"}</span></div>
  <section className="panel simple-result">
   {job ? <DemandReport job={job} intake={detail.glpiIntake}/> : <div className="simple-result-heading">{ready?<CheckCircle2 size={26}/>:<AlertCircle size={26}/>}<div><h2>{ready?"Sem erros":analyzing?"Lendo os dados e documentos do GLPI":job?.status==="Aguardando correção"?(counts.errors?`${counts.errors} erro(s) de preenchimento identificado(s)`:"Referência do GLPI precisa de correção"):missingContract?missingContract.label:unreadableContract&&!job?.comparisons?.length?"Contrato não lido":unidentifiedContract&&!job?.comparisons?.length?"Tipo a confirmar":partial?"Conferência parcial":job?.status==="Aguardando análise"?"Aguardando a leitura do contrato":"Demanda de teste/manual"}</h2><p>{analyzing?"O resultado aparecerá automaticamente nesta página.":ready?"Os dados lidos e comparados com a solicitação do GLPI conferem.":job?.status==="Aguardando correção"?"Confira na tabela o que precisa de correção no documento ou na referência do GLPI.":missingContract?missingContract.message:unreadableContract&&!job?.comparisons?.length?unreadableContract.message:unidentifiedContract&&!job?.comparisons?.length?unidentifiedContract.message:(partial||job?.status==="Aguardando análise")?`Nenhum erro foi identificado até agora${counts.pending?`, mas ${counts.pending} campo(s) não foram lidos ou precisam de confirmação`:''}. Isso não significa que o documento esteja errado.`:job?"Resolva as pendências abaixo. O sistema fará uma nova conferência após a correção.":"Esta demanda não possui documentos importados do GLPI. O formulário de teste continua disponível nos detalhes administrativos."}</p></div></div>}
   {(!!readingFiles.length || job?.typeIdentification) && <details className="pending-groups report-docs">
    <summary>Tipo do pedido e documentos usados{job?.typeIdentification?`: ${job.typeIdentification.type}${job.subtype?' · '+job.subtype:''}`:''}</summary>
    {!!readingFiles.length && <div className="document-type-identification"><strong>Documento recebido: {[...new Set(readingFiles.map((f:any)=>receivedDocumentKind(f.name,f.text)))].join(', ')}</strong><p>{readingFiles.map((f:any)=>f.name).join(' · ')}</p></div>}
    {!!job?.files?.some((f:any)=>f.contractForComparison) && <div className="document-type-identification"><strong>Contratos usados na conferência</strong><p>{job.files.filter((f:any)=>f.contractForComparison).map((f:any)=>f.name).join(" · ")}</p></div>}
    {job?.typeIdentification && <div className="document-type-identification"><strong>Tipo solicitado: {job.typeIdentification.type}{job.subtype?' · '+job.subtype:''}</strong><p>{job.typeIdentification.ticketTitle}</p><small>Identificação: {job.typeIdentification.source}</small></div>}
   </details>}
   <div className="simple-actions">
    {job && can("write") && can("files") && <button className="secondary" disabled={busy||analyzing} onClick={()=>action(()=>api(`/demands/${detail.id}/processing/recheck`,{}),"Leitura e validação atualizadas.")}><RefreshCw size={15}/> Atualizar leitura</button>}
   </div>
   {ready && <small className="muted">A validação verifica preenchimento e consistência. Não verifica autenticidade das assinaturas.</small>}
   {message && <p role="alert" className="inline-warning">{message}</p>}
  </section>
  {detail.glpi_id&&<Fold title="Andamento da leitura dos arquivos" open={analyzing}><ProcessingProgress demands={[{id:detail.id}]} api={api} allowed={!!can('files')&&!!can('bank')} detail/></Fold>}
  {!analyzing && can("files") && can("bank") && <RequestComparison did={detail.id} rows={job?.comparisons} issues={job?.issues} requested={job?.requested} reason={job?.issues?.find((i:any)=>i.field==="contractMissing")?.label} busy={busy} accept={can("write")||can("legal")?(field:string,note:string)=>action(()=>api(`/demands/${detail.id}/processing/resolutions`,{revision:job.revision,kind:"divergence",field,note,confirmed:true}),"Divergência aceita e registrada na auditoria."):undefined} resolve={can("write")?(kind:string,field:string,note:string,value?:string)=>action(()=>api(`/demands/${detail.id}/processing/resolutions`,{revision:job.revision,kind,field,note,value,confirmed:true}),"Decisão registrada; pendências reavaliadas."):undefined}/>}
  {job && can("files") && can("bank") && <Fold title="Documentos recebidos, texto lido e conferência da leitura" hint={`${readingFiles.length} arquivo(s)`}><ReceivedDocuments correctField={can("write")?(fileId:string,field:string,value:string,evidence:string,revision:number)=>action(()=>api(`/demands/${detail.id}/processing/files/${fileId}/fields/${field}/correct-reading`,{revision,value,evidence,confirmed:true}),"Transcrição conferida e gabarito registrados."):undefined} api={can("write")?api:undefined} confirmField={can("write")?(fileId:string,field:string,value:string,revision:number)=>action(()=>api(`/demands/${detail.id}/processing/files/${fileId}/fields/${field}/confirm`,{revision,value,confirmed:true}),"Leitura do campo registrada; pendências reavaliadas."):undefined} did={detail.id} files={readingFiles} issues={issues} revision={job.revision} busy={busy} confirm={can("write")?(fileId:string,revision:number)=>action(()=>api(`/demands/${detail.id}/processing/files/${fileId}/confirm`,{revision,confirmed:true}),"Conferência da leitura registrada; pendências reavaliadas."):undefined}/></Fold>}
  {!analyzing && !!issues.length && can("write") && can("files") && can("bank") && <Fold title="Corrigir dados ou enviar documento legível" open={job?.status==="Aguardando correção"} hint="As pendências estão listadas no relatório acima"><section className="simple-corrections">
   {filesProblem && !manual && allKeys.length>keys.length && <p className="muted">Confira primeiro o texto dos anexos. Se a leitura ficou inconclusiva, envie uma cópia mais legível para identificar os dados. <button type="button" className="text-button" onClick={()=>setManual(true)}>Ou completar os dados manualmente</button></p>}
   {can("write") && can("files") && can("bank") && <form key={job.revision} onSubmit={e=>{
    e.preventDefault();const f=new FormData(e.currentTarget),values:Record<string,string>={};
    for(const key of keys)if(f.has(key)){values[key]=String(f.get(key)||"");f.delete(key);}
    f.set("values",JSON.stringify(values));f.set("revision",String(job.revision));const file=f.get("file") as File;if(!file?.size)f.delete("file");
    action(()=>api(`/demands/${detail.id}/processing/correct`,f),"Correções salvas e validadas novamente.");
   }}>
    <div className="form-grid">{keys.map(key=><label key={key}>{labels[key]}{key==="matriz"?<select name={key} defaultValue={job.values?.[key]||""}><option value="">Selecione a matriz correta</option>{matrices.map((m:any)=><option key={m.id} value={m.id}>{m.id} · {m.school}</option>)}</select>:key==="modalidade"?<select name={key} defaultValue={job.values?.[key]||""}><option value="">Selecione</option>{["Garantia Completa","Garantia Conjunta","Garantia Prevista"].map(x=><option key={x}>{x}</option>)}</select>:<input name={key} type={dateKeys.includes(key)?"date":"text"} defaultValue={job.values?.[key]||""} placeholder={["remuneracao","garantia","repasse","repasseSegundo"].includes(key)?"Ex.: 11,84%":undefined}/>}<small className="correction-hint">{issues.filter((i:any)=>i.field===key).map((i:any)=>[i.message,i.found?`Encontrado: ${i.found}.`:"",i.expected?`Solicitado: ${i.expected}.`:""].join(" ")).join(" ")}</small></label>)}</div>
    {filesProblem && <details className="pending-groups" open><summary>Enviar documento legível ou corrigido</summary><p>O original será preservado. Envie PDF, imagem, Word, ODT, XLSX, PPTX, TXT ou CSV, até 20 MB. Fotos e digitalizações passam por OCR e conferência.</p><label>Anexo que está sendo corrigido<select name="document_id" defaultValue=""><option value="">Selecione</option>{(detail.glpiIntake?.documents||[]).map((f:any)=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label><label>Arquivo legível<input type="file" name="file" accept=".docx,.doc,.pdf,.png,.jpg,.jpeg,.webp,.tif,.tiff,.bmp,.gif,.txt,.csv,.odt,.xlsx,.pptx"/></label></details>}
    {(keys.length>0 || filesProblem || issues.some((i:any)=>i.field==="template")) && <button className="primary" disabled={busy}>Salvar correções e validar</button>}
   </form>}
  </section></Fold>}
  {detail.glpiIntake && <Fold title="Conversa do GLPI" hint={`${detail.glpiIntake.conversation?.length||0} mensagem(ns)`}><section className="simple-source" id="conversa-glpi">
   <GlpiConversation messages={detail.glpiIntake.conversation} documents={detail.glpiIntake.documents}
    fallback={detail.glpiIntake.text} partial={detail.glpiIntake.documentsAvailable === false} approvalsPartial={detail.glpiIntake.approvalCoverage === "partial"}
    attachmentUrl={can("files") && can("bank") ? documentId => {
     const cached = job?.files?.find((file:any) => String(file.document_id) === documentId && file.available && !file.corrected);
     return cached ? `/api/demands/${detail.id}/processing/files/${cached.id}` :
      `/api/glpi/tickets/${encodeURIComponent(detail.glpi_id)}/documents/${encodeURIComponent(documentId)}/download`;
    } : undefined}
    imageUrl={can("files") && can("bank") ? documentId => {
     const cached = job?.files?.find((file:any) => String(file.document_id) === documentId && file.available && !file.corrected);
     return cached && /\.(png|jpe?g|webp|gif|tiff?|bmp)$/i.test(cached.name) ? `/api/demands/${detail.id}/processing/files/${cached.id}/view` : undefined;
    } : undefined} />
  </section></Fold>}
  {!detail.glpiIntake && <details className="panel simple-source"><summary>Solicitação original</summary><p className="source-text">{detail.data.motivo || "Demanda registrada manualmente."}</p></details>}

  {detail.glpi_id && <FinalizeDemand did={detail.id} stage={detail.stage} can={can} api={api} action={action} busy={busy}/>}
  <details className="simple-admin"><summary>Detalhes administrativos e histórico</summary><p className="muted">Controles adicionais de cadastro, governança e auditoria.</p><button className="secondary" onClick={onAdvanced}>Abrir detalhes administrativos</button></details>
 </>;
}
