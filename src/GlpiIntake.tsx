import { useState } from "react";
import { MatrixImport } from "./MatrixImport";
import { AttachmentCheck } from "./AttachmentCheck";
const types = ["Contrato de garantia","Contrato educacional","Contrato fornecedor","Contrato marketing","Aditivo","CNPJ solidário","Antecipação K-invest","Parcelamento","Migração de modalidade","Distrato","Descredenciamento","Renovação com pendências","Alteração societária"];
const subtypes = ["Conta bancária","Vigência","Percentual/data de repasse","Cashback","Taxa de remuneração"];
export function GlpiIntake({ detail, data, can, api, action, busy, back, registry }: any) {
  const intake = detail.glpiIntake;
  const [organization, setOrganization] = useState(detail.school_id || "");
  const [type, setType] = useState(intake.analysis?.suggestion?.type || "");
  const [matrix, setMatrix] = useState("");
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState("");
  const selected = (data.organizations || []).find((o: any) => o.id === organization);
  const needsMatrix = type === "Aditivo" || types.slice(5).includes(type);
  async function download(doc: any) {
    setDownloading(doc.id); setError("");
    try {
      const response = await fetch(`/api/glpi/tickets/${intake.ticket_id}/documents/${doc.id}/download`);
      if (!response.ok) throw Error((await response.json()).error || "Falha no download");
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement("a"); a.href = url; a.download = doc.name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e: any) { setError(e.message); }
    finally { setDownloading(""); }
  }
  return <>
    <button className="back" onClick={back}>← Voltar para Demandas</button>
    <div className="page-heading"><div><h1>Conferir recebimento</h1><p>{detail.id} • GLPI #{intake.ticket_id} • Recebido automaticamente</p></div><span className="badge warn">Aguardando conferência</span></div>
    <div className="detail-grid">
      <section className="panel"><h2>Solicitação original</h2><h3>{intake.title}</h3><p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{intake.text}</p>
        <h3>Anexos do chamado</h3>
        {(intake.documents || []).map((doc: any) => <div className="document glpi-attachment" key={doc.id}><div><strong>{doc.name}</strong></div>{can("files") && can("bank") && <button className="secondary" disabled={!!downloading} onClick={() => download(doc)}>{downloading === doc.id ? "Baixando…" : "Baixar anexo"}</button>}</div>)}
        {error && <p className="inline-warning" role="alert">{error}</p>}
        <h3>Pendências identificadas</h3><ul>{(intake.analysis?.pendencies || []).map((p: string) => <li key={p}>{p}</li>)}</ul>
        <p className="muted">O recebimento não confirma dados nem aprova o contrato. Confira a sugestão de tipo nos documentos.</p>
      </section>
      <section className="panel"><h2>Conferência do recebimento</h2>
        {can("write") && can("confirm") ? <form className="intake-form" onSubmit={event => {
          event.preventDefault(); const form = new FormData(event.currentTarget);
          action(() => api(`/demands/${detail.id}/intake`, { ...Object.fromEntries(form), expected_version: detail.data_version, expected_hash: intake.current_hash, attested: form.get("attested") === "on" }, "PUT"), "Recebimento conferido. Complete os dados e evidências antes de gerar a minuta.");
        }}>
          <label>Organização<select name="school_id" value={organization} onChange={e => setOrganization(e.target.value)} required><option value="">Selecione após conferir o CNPJ</option>{(data.organizations || []).map((o: any) => <option key={o.id} value={o.id}>{o.name} — {o.cnpj}</option>)}</select></label>
          <button type="button" className="text-button" onClick={registry}>Consultar/cadastrar organizações</button>
          {selected?.organization_kind === "Aguardando classificação" && <label>Confirmar categoria<select name="organization_kind" required defaultValue=""><option value="">Selecione após conferir</option><option>Escola</option><option>Fornecedor</option><option>Outra organização</option></select></label>}
          {selected && selected.organization_kind !== "Aguardando classificação" && <p>Categoria: {selected.organization_kind}</p>}
          <label>Tipo de demanda<select name="type" value={type} onChange={e => setType(e.target.value)} required><option value="">A classificar</option>{types.map(t => <option key={t}>{t}</option>)}</select></label>
          {type === "Aditivo" && <label>Subtipo<select name="subtype" required defaultValue={intake.analysis?.suggestion?.subtype || ""}><option value="">Selecione</option>{subtypes.map(t => <option key={t}>{t}</option>)}</select></label>}
          {needsMatrix && <label>Contrato matriz assinado<select name="matrix" required value={matrix} onChange={e => setMatrix(e.target.value)}><option value="">Selecione a matriz conferida</option>{data.contracts.filter((c: any) => c.school_id === organization && c.instrument_kind === "Matriz" && (c.status === "Assinado" || (type === "Migração de modalidade" && c.status === "Distratado"))).map((c: any) => <option key={c.id} value={c.id}>{c.id} • {c.school}</option>)}</select></label>}
          <label>Responsável<select name="owner" required defaultValue={detail.owner || ""}><option value="">Selecione</option>{data.users.filter((u: any) => ["Administrador","Operação","Risco","Solicitante"].includes(u.role)).map((u: any) => <option key={u.id} value={u.id}>{u.name} — {u.role}</option>)}</select></label>
          <label>Prioridade<select name="priority" defaultValue={detail.priority}><option>Normal</option><option>Alta</option><option>Urgente</option></select></label>
          <label>Prazo confirmado<input type="date" name="due" required defaultValue={detail.due || ""} /></label>
          <label>Referência da conferência<textarea name="note" minLength={10} maxLength={500} required placeholder="Informe o que foi conferido e a referência dos documentos." /></label>
          <label><input type="checkbox" name="attested" required /> Conferi a solicitação, o CNPJ, a categoria, o tipo, o responsável, o prazo e a matriz quando aplicável.</label>
          <button className="primary" disabled={busy}>Confirmar recebimento</button>
        </form> : <p>Aguardando conferência por pessoa com permissão de operação.</p>}
        {needsMatrix && organization === detail.school_id && <MatrixImport detail={detail} can={can} action={action} api={api} busy={busy} onCreated={setMatrix} />}
        {needsMatrix && !can("risk") && <p className="muted">Se a matriz não estiver cadastrada, solicite o cadastro ao responsável de Risco ou Administrador.</p>}
      </section>
    </div>
    <AttachmentCheck key={detail.id} detail={detail} can={can} api={api} action={action} busy={busy} />
  </>;
}
