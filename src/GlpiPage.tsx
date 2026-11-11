import { GlpiConversation } from "./GlpiConversation";
import React, { useEffect, useState, useRef } from "react";
import { RefreshCw, TriangleAlert, Link2, Inbox } from "lucide-react";
import { organizationAllowed } from "../shared/organization-policy";
import {fieldLabels,officialInputs} from '../shared/official-fields';
import {glpiStatusLabel,glpiPriorityLabel,matchesDemandQueue,glpiPriorityRank,type DemandQueue} from "../shared/glpi-ticket-meta";
type Props = {
  data: any;
  can: (p: string) => boolean;
  action: (fn: () => Promise<any>, message?: string) => Promise<void>;
  api: (path: string, body?: any, method?: string) => Promise<any>;
  busy: boolean;
  open: (id: string) => void;
};
const subtypes = ["Conta bancária", "Vigência", "Percentual/data de repasse", "Cashback", "Taxa de remuneração"];
const types = [
  "Aditivo", "Contrato de garantia", "Contrato educacional", "Contrato fornecedor", "Contrato marketing",
  "CNPJ solidário", "Antecipação K-invest", "Parcelamento", "Migração de modalidade", "Distrato",
  "Descredenciamento", "Renovação com pendências", "Alteração societária",
];
const stateLabel: Record<string, string> = {
  novo: "Aguardando triagem",
  alterado: "Alterado no GLPI",
  vinculado: "Vinculado",
  "alterado após vínculo": "Alterado após vínculo",
};
const inWeek = () => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
/** Read-only GLPI queue: a person confirms school, type and contract before a demand exists. */
export function GlpiPage({ data, can, action, api, busy, open }: Props) {
  const [search,setSearch]=useState('');
  const [queue,setQueue]=useState<Exclude<DemandQueue,"active">>("open");
  const [syncing,setSyncing]=useState(false),[statusError,setStatusError]=useState('');
  const refreshing=useRef(false);
  const [status, setStatus] = useState<any>(null),
    [tickets, setTickets] = useState<any[]>([]),
    [selected, setSelected] = useState(""),
    [error, setError] = useState("");
  async function refresh() {
    if(refreshing.current)return;
    refreshing.current=true;
    setError("");
    try {
      const [s,t]=await Promise.allSettled([api('/glpi/status'),api('/glpi/tickets')]);
      if(s.status==='fulfilled'){setStatus(s.value);setStatusError('');}
      else setStatusError(s.reason?.message||'Não foi possível consultar o estado da integração.');
      if(t.status==='fulfilled')setTickets(t.value);
      else setError(t.reason?.message||'Não foi possível atualizar os chamados.');
    } finally {refreshing.current=false;}
  }
  useEffect(() => {
    refresh();
    const timer=setInterval(()=>{void refresh();},15000);
    return ()=>clearInterval(timer);
  }, [data]);
  const isSyncing=syncing||(!statusError&&status?.running===true);
  async function synchronize(){
    if(isSyncing)return;
    setSyncing(true);
    await action(async()=>{try{await api('/sync',{});}finally{setSyncing(false);await refresh();}},'Sincronização concluída. Dados locais preservados.');
  }
  const ticket = tickets.find((t) => t.external_id === selected);
  const normalize=(value:string)=>value.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
  const groups = [
    ["open","Em andamento no GLPI"],
    ["pending","Pendentes no GLPI"],
    ["solved","Chamados solucionados"],
    ["closed","Chamados finalizados"],
    ["all","Todos os chamados"],
  ] as const;
  const inQueue=(ticket:any,key:typeof queue)=>matchesDemandQueue({glpiOrigin:ticket},key);
  const visible=tickets.filter(t=>inQueue(t,queue)&&normalize([t.external_id,t.title,t.analysis.fields.razaoSocial?.value,t.analysis.fields.cnpj?.value].join(' ')).includes(normalize(search.trim()))).sort((a,b)=>glpiPriorityRank(b.priority)-glpiPriorityRank(a.priority)||b.external_id.localeCompare(a.external_id,undefined,{numeric:true}));
  return (
    <>
      <section className="panel glpi-sync-panel">
        <div className="panel-heading">
          <h2>Integração GLPI (somente leitura)</h2>
          <span className={"badge " + (status?.mode === "real" && !status?.problems.length ? "ok" : "warn")}>
            {!status ? statusError?'Status indisponível':'Verificando integração…' : status.mode==='real'?'Modo real':'Demonstração'}
          </span>
        </div>
        <div className="glpi-sync-toolbar">
          <div>
            <strong>Sincronização automática</strong>
            <p className="muted">{!status ? statusError?'Não foi possível consultar o agendamento.':'Carregando agendamento…' : status.dailyTimes?.length ? `Todos os dias às ${status.dailyTimes.join(', ')} · Brasília` : status.intervalMinutes ? `A cada ${status.intervalMinutes} minutos` : 'Desativada — sincronize manualmente'}</p>
          </div>
          {can("sync") && <button className="primary" disabled={busy||isSyncing} aria-busy={isSyncing} onClick={synchronize}><RefreshCw size={16} aria-hidden="true" />{isSyncing?'Sincronizando…':'Sincronizar agora'}</button>}
        </div>
        <p className="muted glpi-sync-note">Importa chamados e documentos. As informações do GLPI são preservadas.</p>
        {status?.problems?.length > 0 && (
          <div className="inline-warning">
            <TriangleAlert size={16} aria-hidden="true" /> Configuração pendente no servidor:{" "}
            {status.problems.join("; ")}.
          </div>
        )}
        {error && <p className="inline-warning">{error}</p>}
        {statusError&&<p className="inline-warning" role="status">{statusError} <button type="button" className="secondary" onClick={()=>{void refresh();}}>Tentar novamente</button></p>}
        <details className="glpi-sync-details">
          <summary>Histórico de sincronização</summary>
          {(data.sync || []).slice(0, 5).map((s: any) => (
            <details className="glpi-sync-entry" key={s.id}>
              <summary><span className={s.status === "Falha" ? "urgent" : "positive"}>{s.status}</span><time dateTime={s.created}>{new Date(s.created).toLocaleString('pt-BR', {timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'})}</time><span className="muted">Ver detalhes</span></summary>
              <p>{s.message}</p>
            </details>
          ))}
          {!data.sync?.length && <p className="muted">Nenhuma sincronização registrada.</p>}
        </details>
        <details className="glpi-sync-details">
          <summary>Como funciona a integração</summary>
          <p>Os chamados importados geram demandas. Confira os dados e a classificação das organizações no portal. O envio para assinatura e o encerramento do chamado continuam no GLPI.</p>
          {status && <p className="muted">{status.mode === 'real' ? `Endereço: ${status.url}.` : 'Dados fictícios de demonstração.'} Grupos autorizados: {status.groups.join(', ')}.</p>}
        </details>
      </section>
      <div className="detail-grid">
        <section className="panel">
          <div className="panel-heading">
            <h2>{groups.find(([key])=>key===queue)?.[1]}</h2>
            <span className="counter">{visible.length}</span>
          </div>
          <div className="glpi-queue-tabs" role="group" aria-label="Separar chamados por status do GLPI">
            {groups.map(([key,label])=><button type="button" key={key} className={queue===key?"primary":"secondary"} aria-pressed={queue===key} onClick={()=>{setQueue(key);setSelected("");}}>
              {label} ({tickets.filter(t=>inQueue(t,key)).length})
            </button>)}
          </div>
          {queue==="open"&&<p className="muted">Chamados novos e em atendimento aparecem nesta lista, em ordem de prioridade do GLPI.</p>}
          <label>Buscar chamado<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Número GLPI, organização ou CNPJ"/></label>
          <p className="muted">Selecione um chamado para ver o pedido e os documentos. A conferência do preenchimento fica na demanda vinculada.</p>
          {!visible.length&&<p role="status">Nenhum chamado encontrado neste filtro.</p>}
          {visible.map((t) => (
            <button
              key={t.external_id}
              className={"ticket-row" + (t.external_id === selected ? " active" : "")}
              onClick={() => setSelected(t.external_id)}
            >
              <strong>#{t.external_id}</strong>
              <span>{t.analysis.fields.razaoSocial?.value || t.title}</span>
              <span className={"badge " + (t.state === "vinculado" ? "ok" : "warn")}>{stateLabel[t.state]}</span>
              <small>
                {glpiStatusLabel(t.status)} • Prioridade GLPI: {glpiPriorityLabel(t.priority)} •{" "}
                {t.analysis.suggestion.type || "Tipo não identificado"}
                {t.analysis.suggestion.subtype ? " • " + t.analysis.suggestion.subtype : ""} •{" "}
                {t.analysis.pendencies.length} item(ns) de triagem
              </small>
            </button>
          ))}
          {!visible.length && (
            <div className="empty">
              <Inbox />
              <h3>{queue==="pending"?"Nenhum chamado pendente importado":queue==="solved"?"Nenhum chamado solucionado importado":"Nenhum chamado nesta lista"}</h3>
              <p>Execute a sincronização para ler os chamados dos grupos autorizados.</p>
            </div>
          )}
        </section>
        <section className="panel">
          {!ticket ? (
            <p className="empty-text">Selecione um chamado para conferir os dados e as pendências.</p>
          ) : (
            <TicketDetail key={ticket.external_id + ticket.state + (ticket.analysis.schoolId || "")} ticket={ticket} data={data} can={can} action={action} api={api} busy={busy} open={open} />
          )}
        </section>
      </div>
    </>
  );
}
function TicketDetail({ ticket, data, can, action, api, busy, open }: Props & { ticket: any }) {
  const a = ticket.analysis;
  const [form, setForm] = useState({
    school_id: a.schoolId || "",
    type: a.suggestion.type || "",
    subtype: a.suggestion.subtype || "",
    matrix: a.matrixId || "",
    owner: data.users.find((u: any) => u.role === "Operação")?.id || data.users[0]?.id || "",
    priority: "Normal",
    due: inWeek(),
    attested: false,
  });
  const [note, setNote] = useState("");
  const set = (key: string, value: any) => setForm((f) => ({ ...f, [key]: value }));
  const matrices = data.contracts.filter(
    (c: any) => c.school_id === form.school_id && c.instrument_kind === "Matriz" && c.status === "Assinado",
  );
  return (
    <>
      <div className="panel-heading">
        <h2>Chamado #{ticket.external_id}</h2>
        <span className={"badge " + (ticket.state === "vinculado" ? "ok" : "warn")}>{stateLabel[ticket.state]}</span>
      </div>
      <p className="muted">
        {glpiStatusLabel(ticket.status)} • Prioridade GLPI: {glpiPriorityLabel(ticket.priority)} •{" "}
        {ticket.title} • Grupos: {ticket.groups.join(", ")} • {ticket.followups} resposta(s) • {ticket.versions} versão(ões)
        registradas
      </p>
      <h3>Conversa do GLPI</h3>
      <GlpiConversation messages={ticket.conversation} documents={ticket.documents} fallback={ticket.requestText}
        partial={ticket.documentsAvailable === false} approvalsPartial={ticket.approvalCoverage === "partial"} attachmentUrl={ticket.mode === "real" && can("files") && can("bank")
          ? id => `/api/glpi/tickets/${encodeURIComponent(ticket.external_id)}/documents/${encodeURIComponent(id)}/download`
          : undefined} />
      <h3>Dados identificados (com origem)</h3>
      <dl className="responsibility">
        {Object.entries(a.fields as Record<string, any>).map(([key, f]) => (
          <React.Fragment key={key}>
            <dt>{{ razaoSocial: "Razão social", cnpj: "CNPJ", motivo: "Motivo", observacoes: "Observações", anexos: "Anexos", remuneracao: "Taxa" }[key] || key}</dt>
            <dd>
              {f.value}
              <small>{f.origin}</small>
            </dd>
          </React.Fragment>
        ))}
      </dl>
      {!!Object.keys(ticket.reference||{}).length && <><h3>Valores de referência para conferir o documento</h3><p className="muted">Extraídos do formulário e das observações deste chamado. Estes são os valores solicitados, separados dos valores lidos no anexo.</p><dl className="responsibility">{Object.entries(ticket.reference as Record<string,string[]>).map(([key,values])=><React.Fragment key={key}><dt>{({...fieldLabels,...officialInputs} as Record<string,string>)[key]||key}</dt><dd>{values.join("; ")}{values.length>1 && <small>Há valores diferentes no próprio pedido; confirmar antes de liberar.</small>}</dd></React.Fragment>)}</dl></>}
      <p className="muted">
        Sugestão: {a.suggestion.type || "—"}
        {a.suggestion.subtype ? " / " + a.suggestion.subtype : ""} ({a.suggestion.basis || "sem base"}). Confirme
        antes de criar.
      </p>
      <h3>Pendências</h3>
      <ul className="pending-list">
        {a.pendencies.map((p: string) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      {ticket.state.startsWith("alterado") && can("confirm") && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            action(() => api("/glpi/tickets/" + ticket.external_id + "/acknowledge", { note }), "Alteração externa revisada.");
          }}
        >
          <div className="inline-warning">
            O chamado mudou no GLPI depois da importação. Os dados da demanda não foram alterados; revise e registre a
            providência.
          </div>
          <label>
            Providência adotada
            <input value={note} onChange={(e) => setNote(e.target.value)} minLength={5} required />
          </label>
          <button className="secondary" disabled={busy}>
            Registrar revisão
          </button>
        </form>
      )}
      {ticket.demand_id ? (
        <button className="secondary" onClick={() => open(ticket.demand_id)}>
          <Link2 size={16} /> Abrir demanda {ticket.demand_id}
        </button>
      ) : can("write") && can("confirm") ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            action(async () => {
              const r = await api("/glpi/tickets/" + ticket.external_id + "/demand", {
                ...form,
                subtype: form.type === "Aditivo" ? form.subtype : undefined,
                matrix: form.matrix || undefined,
              });
              open(r.id);
            }, "Demanda criada a partir do chamado. Confirme os dados antes de gerar documentos.");
          }}
        >
          <h3>Criar demanda a partir do chamado</h3>
          <div className="form-grid">
            <label>
              Escola / organização confirmada
              <select value={form.school_id} onChange={(e) => set("school_id", e.target.value)} required>
                <option value="">Selecione (cadastre a escola se necessário)</option>
                {(data.organizations || data.schools).filter((s: any) => organizationAllowed(form.type, s.organization_kind || "Escola")).map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.name} — {s.cnpj}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tipo
              <select value={form.type} onChange={(e) => setForm(f => ({ ...f, type: e.target.value, school_id: "", matrix: "" }))} required>
                <option value="">Selecione</option>
                {types.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            {form.type === "Aditivo" && (
              <label>
                Tipo de aditivo
                <select value={form.subtype} onChange={(e) => set("subtype", e.target.value)} required>
                  <option value="">Selecione</option>
                  {subtypes.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Contrato matriz assinado
              <select value={form.matrix} onChange={(e) => set("matrix", e.target.value)}>
                <option value="">{matrices.length ? "Selecione" : "Nenhum matriz assinado"}</option>
                {matrices.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.id} {c.start ? `(${c.start} a ${c.end})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Responsável
              <select value={form.owner} onChange={(e) => set("owner", e.target.value)}>
                {data.users.map((u: any) => (
                  <option key={u.id} value={u.id}>
                    {u.name} — {u.role}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Prioridade
              <select value={form.priority} onChange={(e) => set("priority", e.target.value)}>
                <option>Normal</option>
                <option>Alta</option>
                <option>Urgente</option>
              </select>
            </label>
            <label>
              Prazo
              <input type="date" value={form.due} onChange={(e) => set("due", e.target.value)} required />
            </label>
          </div>
          <label className="checkbox">
            <input type="checkbox" checked={form.attested} onChange={(e) => set("attested", e.target.checked)} />
            Conferi escola, tipo e contrato com o chamado. Datas, valores e numeração serão confirmados na demanda.
          </label>
          <button className="primary" disabled={busy || !form.attested}>
            Criar demanda vinculada
          </button>
        </form>
      ) : (
        <p className="muted">Seu perfil não cria demandas a partir de chamados.</p>
      )}
    </>
  );
}
