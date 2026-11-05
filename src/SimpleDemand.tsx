import { useEffect,useState } from "react";
import {receivedDocumentKind} from '../shared/document-heading';
import { Download,RefreshCw,ArrowLeft,CheckCircle2,AlertCircle } from "lucide-react";
import { MatrixImport } from "./MatrixImport";
import { SignedHistoryPanel } from "./GovernancePanel";
import { fieldLabels } from "../shared/official-fields";
import { ReceivedDocuments } from "./ReceivedDocuments";
import { RequestComparison } from "./RequestComparison";
import { ProcessingProgress } from './ProcessingProgress';
const baseLabels:Record<string,string>={...fieldLabels,modalidade:"Modalidade de garantia",endereco:"Endereço",matriz:"Contrato matriz",motivo:"Descrição da solicitação"};
const dateKeys=["inicio","fim","dataAssinaturaMatriz","dataFormalizacao"];
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
 const ready=job?.status==="Sem erros",analyzing=job?.status==="Analisando";
 const counts={errors:(job?.comparisons||[]).filter((r:any)=>r.status==='different').length,pending:(job?.comparisons||[]).filter((r:any)=>['missing','review','ambiguous'].includes(r.status)).length};
 const title=(data.organizations||data.schools).find((s:any)=>s.id===detail.school_id)?.name || detail.data.razaoSocial || "Contrato recebido";
 const compared=new Set((job?.comparisons||[]).map((r:any)=>r.field));
 const issues=(job?.issues||[]).filter((i:any)=>compared.has(i.field)||/^(file:|review:|files$|contractMissing$|processing$)/.test(i.field)),allKeys=[...new Set<string>(issues.map((i:any)=>i.field).filter((k:string)=>!!labels[k] && k!=="aditivo"))];
 const matrices=data.contracts.filter((c:any)=>c.school_id===detail.school_id && c.instrument_kind==="Matriz" && c.status==="Assinado");
 const filesProblem=issues.some((i:any)=>i.field.startsWith("file:")||i.field.startsWith("review:"));
 const keys=allKeys.filter(key=>!filesProblem || manual || issues.some((i:any)=>i.field===key && (i.found || i.expected)));
 return <>
  <button className="back" onClick={onBack}><ArrowLeft size={16}/> Voltar para Demandas</button>
  <div className="page-heading"><div><span className="eyebrow">{detail.id}{detail.glpi_id?` · GLPI #${detail.glpi_id}`:" · Demanda de teste/manual"}</span><h1>{title}</h1></div><span className={"badge "+(ready?"conference-clean":job?.status==="Aguardando correção"?"conference-correction":"conference-analysis")}>{job?.status || "Demanda manual"}</span></div>
  <section className="panel simple-result">
   <div className="simple-result-heading">{ready?<CheckCircle2 size={26}/>:<AlertCircle size={26}/>}<div><h2>{ready?"Sem erros":analyzing?"Lendo os dados e documentos do GLPI":job?.status==="Aguardando correção"?`${counts.errors} erro(s) de preenchimento identificado(s)`:job?.status==="Aguardando análise"?"Parte dos dados não foi lida ou confirmada":"Demanda de teste/manual"}</h2><p>{analyzing?"O resultado aparecerá automaticamente nesta página.":ready?"Os dados lidos e comparados com a solicitação do GLPI conferem.":job?.status==="Aguardando correção"?"Veja na tabela abaixo o que está no documento e como deve ser preenchido conforme o GLPI.":job?.status==="Aguardando análise"?`Nenhum erro foi identificado até agora${counts.pending?`, mas ${counts.pending} campo(s) não foram lidos ou precisam de confirmação`:''}. Isso não significa que o documento esteja errado.`:job?"Resolva as pendências abaixo. O sistema fará uma nova conferência após a correção.":"Esta demanda não possui documentos importados do GLPI. O formulário de teste continua disponível nos detalhes administrativos."}</p></div></div>
   {!!job?.files?.length && <div className="document-type-identification"><strong>Documento recebido: {[...new Set(job.files.map((f:any)=>receivedDocumentKind(f.name,f.text)))].join(', ')}</strong><p>{job.files.map((f:any)=>f.name).join(' · ')}</p></div>}
   {job?.typeIdentification && <div className="document-type-identification"><strong>Tipo solicitado: {job.typeIdentification.type}{job.subtype?' · '+job.subtype:''}</strong><p>{job.typeIdentification.ticketTitle}</p><small>Identificação: {job.typeIdentification.source}</small></div>}
   <div className="simple-actions">
    {job && can("write") && can("files") && <button className="secondary" disabled={busy||analyzing} onClick={()=>action(()=>api(`/demands/${detail.id}/processing/recheck`,{}),"Leitura e validação atualizadas.")}><RefreshCw size={15}/> Atualizar leitura</button>}
   </div>
   {ready && <small className="muted">A validação verifica preenchimento e consistência. Não verifica autenticidade das assinaturas.</small>}
   {message && <p role="alert" className="inline-warning">{message}</p>}
  </section>
  <nav className="review-jump-links" aria-label="Ir para a conferência"><a href="#documento-recebido" className="secondary">Ver documento preenchido</a>{!!job?.comparisons?.length && <a href="#conferencia-preenchimento" className="secondary">Ver preenchimento e correções</a>}</nav>
  {detail.glpi_id&&<ProcessingProgress demands={[{id:detail.id}]} api={api} allowed={!!can('files')&&!!can('bank')} detail/>}
  {!analyzing && can("files") && can("bank") && <RequestComparison did={detail.id} rows={job?.comparisons} issues={job?.issues}/>}
  {job && can("files") && can("bank") && <ReceivedDocuments correctField={can("write")?(fileId:string,field:string,value:string,evidence:string,revision:number)=>action(()=>api(`/demands/${detail.id}/processing/files/${fileId}/fields/${field}/correct-reading`,{revision,value,evidence,confirmed:true}),"Transcrição conferida e gabarito registrados."):undefined} api={can("write")?api:undefined} confirmField={can("write")?(fileId:string,field:string,value:string,revision:number)=>action(()=>api(`/demands/${detail.id}/processing/files/${fileId}/fields/${field}/confirm`,{revision,value,confirmed:true}),"Leitura do campo registrada; pendências reavaliadas."):undefined} did={detail.id} files={job.files||[]} issues={issues} revision={job.revision} busy={busy} confirm={can("write")?(fileId:string,revision:number)=>action(()=>api(`/demands/${detail.id}/processing/files/${fileId}/confirm`,{revision,confirmed:true}),"Conferência da leitura registrada; pendências reavaliadas."):undefined}/>}
  {!analyzing && !!issues.length && <section className="panel simple-corrections">
   <h2>Leituras e pendências para resolver</h2>
   <ul className="simple-issues">{issues.filter((i:any)=>!allKeys.includes(i.field)||!can("write")).map((i:any,n:number)=><li key={i.field+n}><strong>{i.label?.startsWith("file:")?i.source||"Documento":i.label}</strong><p>{i.message}</p>{i.pendingReason&&<p><strong>{i.pendingReason.label} · Próxima ação:</strong> {i.pendingReason.action}</p>}{i.found && <small>Encontrado: {i.found}</small>}{i.expected && <small>Solicitado: {i.expected}</small>}</li>)}</ul>
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
  </section>}
  <details className="panel simple-source"><summary>Solicitação original e documentos</summary><p className="source-text">{detail.glpiIntake?.text || detail.data.motivo || "Demanda registrada manualmente."}</p>{(job?.files||[]).map((f:any)=><div className="document" key={f.id}><div><strong>{f.name}</strong><small>{f.corrected?"Cópia corrigida no portal":"Original importado do GLPI"}</small></div><a className="secondary" href={`/api/demands/${detail.id}/processing/files/${f.id}`}>Baixar original</a>{f.text && <details><summary>Ver texto</summary><pre className="contract-text-preview">{f.text}</pre></details>}</div>)}</details>
  <details className="simple-admin"><summary>Detalhes administrativos e histórico</summary><p className="muted">Controles adicionais de cadastro, governança e auditoria.</p><button className="secondary" onClick={onAdvanced}>Abrir detalhes administrativos</button></details>
 </>;
}
