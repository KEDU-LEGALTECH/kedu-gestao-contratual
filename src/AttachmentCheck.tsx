import { useState } from "react";
const fields: Record<string,string> = {cnpj:"CNPJ da contratante",remuneracao:"Taxa de remuneração",garantia:"Percentual de garantia",repasse:"Percentual de repasse",valor:"Valor de referência"};
const statuses: Record<string,string> = {conforme:"Campos selecionados conferidos — revisão contratual pendente",divergente:"Erro encontrado — correção manual",inconclusiva:"Conferência inconclusiva — verificar arquivo"};
export function AttachmentCheck({detail,can,api,action,busy}:any) {
  const [selected,setSelected]=useState("");
  const [preview,setPreview]=useState<any>(null);
  const [error,setError]=useState("");
  const [editing,setEditing]=useState(false);
  const docs=detail.glpiIntake?.documents || [];
  if(!detail.glpi_id || !can("bank") || !can("files"))return null;
  const checks=detail.attachmentChecks || [],current=checks.find((c:any)=>c.document_id===selected);
  return <section className="panel attachment-check">
    <div className="panel-heading"><h2>Analisar valores do contrato recebido</h2><span className="badge">GLPI #{detail.glpi_id}</span></div>
    <p className="muted">Compare o anexo com os valores desejados e sua fonte. O sistema identifica campos no texto DOCX. PDF, imagem, campo ausente ou vários valores possíveis exigem conferência manual. Valores corretos não aprovam cláusulas ou assinaturas.</p>
    {can("write") && can("review") && !["Concluído","Cancelado","Em assinatura"].includes(detail.stage) && <details open={!checks.length || editing} className="pending-groups">
      <summary>Selecionar anexo e valores para comparar</summary>
      <form onSubmit={e=>{
        e.preventDefault();setError("");setPreview(null);
        const f=new FormData(e.currentTarget),expected=Object.fromEntries(Object.keys(fields).map(k=>[k,String(f.get(k)||"").trim()]).filter(([,v])=>v));
        if(!Object.keys(expected).length){setError("Informe pelo menos um valor esperado para comparar.");return;}
        f.set("expected",JSON.stringify(expected));f.set("expected_version",String(detail.data_version));f.set("expected_hash",detail.glpiIntake.current_hash);f.set("attested","true");
        const file=f.get("file") as File;if(!file?.size)f.delete("file");
        if(file?.size && !current){setError("Primeiro analise o original antes de enviar uma correção.");return;}
        if(current)f.set("parent_id",current.id);
        for(const k of Object.keys(fields))f.delete(k);
        action(()=>api(`/demands/${detail.id}/attachment-checks`,f),"Análise registrada. Consulte o resultado; a revisão contratual continua necessária.");
      }}>
        <label>Anexo a analisar<select name="document_id" value={selected} required onChange={e=>{setSelected(e.target.value);setPreview(null);}}><option value="">Selecione o contrato correto</option>{docs.map((d:any)=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <p className="muted">Preencha somente os campos a comparar. Percentuais: 11,84%. Valores em reais: 10.000,00.</p>
        <div className="form-grid">{Object.entries(fields).map(([key,label])=><label key={key}>{label}<input name={key} key={selected+(current?.id||"initial")+key} defaultValue={current?.expected[key] || (key==="cnpj"?detail.data.cnpj || "":detail.confirmed?detail.data[key] || "":key==="remuneracao"?detail.glpiIntake?.analysis?.fields?.remuneracao?.value || "":"")} placeholder={key==="cnpj"?"00.000.000/0000-00":key==="valor"?"Ex.: 10.000,00":"Ex.: 11,84%"} /></label>)}</div>
        {detail.glpiIntake?.analysis?.fields?.remuneracao && <p className="muted">Origem da taxa sugerida: {detail.glpiIntake.analysis.fields.remuneracao.origin}. Confira antes de analisar.</p>}
        <label>Fonte dos valores desejados<textarea name="reference" minLength={10} maxLength={500} required placeholder="Identifique a solicitação GLPI e a cláusula ou documento conferido." /></label>
        {current && <label>Versão corrigida manualmente (opcional, DOCX até 5 MB)<input name="file" type="file" accept=".docx" /><small>Baixe, corrija no Word/Google Docs e envie a nova cópia. Sem arquivo, o original do GLPI será lido novamente.</small></label>}
        <label className="checkbox"><input type="checkbox" required /> Conferi a fonte e os valores desejados. Esta comparação não substitui a revisão contratual.</label>
        <button className="primary" disabled={busy || !docs.length}>{busy?"Analisando…":"Puxar anexo e analisar valores"}</button>
      </form>
    </details>}
    {!docs.length && <p className="inline-warning">Nenhum anexo disponível. Obtenha o contrato antes de analisar.</p>}
    {checks.map((c:any)=><details key={c.id} className="pending-groups" open={c.id===checks[0]?.id}>
      <summary>{c.name} — {c.stale?"Análise desatualizada — conferir novamente":statuses[c.status]}</summary>
      <p>Fonte: {c.reference}. {c.parent_id?"Nova versão vinculada à conferência anterior.":"Original recebido do GLPI."}</p>
      <p className="muted">Campos comparados: {Object.keys(c.expected).map(k=>fields[k] || k).join(", ")}. Os demais dados e as cláusulas continuam sujeitos à revisão contratual.</p>
      <div className="attachment-results">{c.findings.map((f:any,i:number)=><article key={i} className={f.matched?"check-matched":"check-finding"}><h3>{fields[f.field] || f.field}</h3><p><strong>Esperado:</strong> {f.expected}<br/><strong>Encontrado:</strong> {f.found}</p><p>{f.location}</p><p><strong>Como proceder:</strong> {f.guidance}</p></article>)}</div>
      {can("write") && can("review") && !["Concluído","Cancelado","Em assinatura"].includes(detail.stage) && <button type="button" className="secondary" onClick={()=>{setSelected(c.document_id);setEditing(true);requestAnimationFrame(()=>document.querySelector(".attachment-check form")?.scrollIntoView({behavior:"smooth",block:"start"}));}}>Enviar correção manual ou conferir novamente</button>}
      <div className="attachment-actions"><button type="button" className="secondary" onClick={async()=>{setError("");try{setPreview(await api(`/demands/${detail.id}/attachment-checks/${c.id}/preview`));}catch(e:any){setError(e.message);}}}>Visualizar texto</button><a className="secondary" href={`/api/demands/${detail.id}/attachment-checks/${c.id}/download`}>Baixar esta versão</a>{c.status==="conforme" && !c.stale && <button type="button" className="secondary" onClick={()=>document.querySelector(".intake-form, .governance-summary")?.scrollIntoView({behavior:"smooth",block:"start"})}>Seguir para conferência contratual →</button>}</div>
    </details>)}
    {preview && <details open className="pending-groups"><summary>Texto extraído — {preview.name}</summary><p className="muted">Para visualizar a diagramação e editar, baixe o documento.</p><pre className="contract-text-preview">{preview.text || "Texto não disponível. Abra o arquivo original e confira manualmente."}</pre></details>}
    {error && <p role="alert" className="inline-warning">{error}</p>}
  </section>;
}
