import { useState } from "react";

export function DemandDocuments({ detail, can }: any) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const bundle = detail.documentBundle;
  async function download(doc: any) {
    setError(""); setBusy(String(doc.id));
    try {
      const response = await fetch(`/api/glpi/tickets/${detail.glpi_id}/documents/${doc.id}/download`);
      if (!response.ok) throw Error((await response.json()).error || "Não foi possível baixar o arquivo.");
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement("a"); a.href = url; a.download = doc.name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e: any) { setError(e.message); } finally { setBusy(""); }
  }
  return <section className="panel demand-documents">
    <h2>Documentos desta demanda</h2>
    {!bundle ? <p className="muted">Consulta aos arquivos restrita ao perfil autorizado.</p> : <>
      <p className="muted">Matriz vinculada: {bundle.matrixId || "Ainda não selecionada"}. Anexos do chamado precisam de conferência antes de serem registrados como evidência.</p>
      <div className="document-groups">
        <div><h3>Matriz e aditivos assinados</h3>
          {bundle.externalMatrix && <p><a href={`/api/demands/${detail.id}/matrix/${bundle.externalMatrix.contract_id}/download`}>{bundle.externalMatrix.name}</a><small className="document-source">Matriz externa · assinatura declarada em {bundle.externalMatrix.signature_date.split("-").reverse().join("/")} · {bundle.externalMatrix.reference}</small></p>}
          {bundle.signed.length ? bundle.signed.map((d: any) => <p key={d.id}><a href={`/api/documents/${d.id}/download?signed=1`}>{d.parent_id ? `Aditivo ${d.sequence}` : "Contrato matriz"} — versão {d.version}</a><small className="document-source">Origem: demanda {d.demand_id}</small></p>) : !bundle.externalMatrix && <p className="muted">Nenhum arquivo assinado acessível no histórico vinculado. O cadastro da matriz, sozinho, não inclui o arquivo.</p>}
        </div>
        <div><h3>Anexos do GLPI</h3>
          {detail.glpiIntake?.documents?.length ? detail.glpiIntake.documents.map((d: any) => <p key={d.id}><button className="text-button" disabled={!!busy} onClick={() => download(d)}>{busy === String(d.id) ? "Baixando…" : d.name}</button></p>) : <p className="muted">Nenhum anexo disponível neste chamado.</p>}
        </div>
        <div><h3>Evidências cadastradas</h3>
          {bundle.evidence.length ? bundle.evidence.map((d: any) => <p key={d.id}><a href={`/api/demands/${detail.id}/evidence/${d.id}/download`}>{d.name}</a><small className="document-source">{detail.evidenceLabels[d.kind] || d.kind} · {d.verified_at ? "Conferência registrada" : "Aguardando conferência"}</small></p>) : <p className="muted">Anexe e confira as evidências na seção de documentação abaixo.</p>}
        </div>
        <div><h3>Minutas desta demanda</h3>
          {detail.documents.length ? detail.documents.map((d: any) => <p key={d.id}><a href={`/api/documents/${d.id}/download`}>Minuta v{d.version}</a>{!!d.is_signed && <> · <a href={`/api/documents/${d.id}/download?signed=1`}>Assinado</a></>}</p>) : <p className="muted">A minuta aparecerá aqui após geração ou envio do DOCX.</p>}
        </div>
      </div>
    </>}
    {error && <p role="alert" className="inline-warning">{error}</p>}
  </section>;
}

export function DemandPending({ detail, labels }: any) {
  const fields = [...new Set<string>(detail.missing.filter((s: string) => labels[s]))];
  const documents = [...new Set<string>(detail.missing.filter((s: string) => s === "Documentação obrigatória" || Object.values(detail.evidenceLabels || {}).includes(s)))];
  const checks = [...new Set<string>(detail.missing.filter((s: string) => !fields.includes(s) && !documents.includes(s)))];
  const focus = (key: string) => { const el = document.getElementById("data-" + key); el?.scrollIntoView({ behavior: "smooth", block: "center" }); el?.focus(); };
  if (!detail.missing.length) return null;
  return <details className="pending-groups"><summary>Pendências para confirmar <span>{fields.length + documents.length + checks.length}</span></summary>
    <p>Você pode salvar um rascunho. Complete os itens abaixo antes de confirmar ou avançar.</p>
    {!!fields.length && <div><h3>Dados a preencher</h3><ul>{fields.map(key => <li key={key}><button type="button" className="text-button" onClick={() => focus(key)}>{labels[key]}</button></li>)}</ul></div>}
    {!!documents.length && <div><h3>Documentos a apresentar e conferir</h3><p>Anexe o arquivo e registre sua conferência na seção de documentação.</p><ul>{documents.map(s => <li key={s}>{s}</li>)}</ul></div>}
    {!!checks.length && <div><h3>Conferências e vínculos</h3><p>Verifique os controles de governança e os documentos de origem.</p><ul>{checks.map(s => <li key={s}>{s}</li>)}</ul></div>}
  </details>;
}
