import React, { useEffect, useState } from "react";
import { RefreshCw, TriangleAlert, Link2, FileText, Inbox, Download } from "lucide-react";
import { organizationAllowed } from "../shared/organization-policy";
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
  const [status, setStatus] = useState<any>(null),
    [tickets, setTickets] = useState<any[]>([]),
    [selected, setSelected] = useState(""),
    [error, setError] = useState("");
  async function refresh() {
    setError("");
    try {
      const [s, t] = await Promise.all([api("/glpi/status"), api("/glpi/tickets")]);
      setStatus(s);
      setTickets(t);
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => {
    refresh();
  }, [data]);
  const ticket = tickets.find((t) => t.external_id === selected);
  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <h2>Integração GLPI (somente leitura)</h2>
          <span className={"badge " + (status?.mode === "real" && !status?.problems.length ? "ok" : "warn")}>
            {status?.mode === "real" ? "Modo real" : "Demonstração"}
          </span>
        </div>
        {status && (
          <p className="muted">
            {status.mode === "real" ? `Endereço: ${status.url}. ` : "Chamados fictícios para demonstração. "}
            Grupos autorizados: {status.groups.join(", ")}. Agendamento:{" "}
            {status.intervalMinutes ? `a cada ${status.intervalMinutes} min` : "desativado (execução manual)"}.
          </p>
        )}
        {status?.problems?.length > 0 && (
          <div className="inline-warning">
            <TriangleAlert size={16} aria-hidden="true" /> Configuração pendente no servidor:{" "}
            {status.problems.join("; ")}.
          </div>
        )}
        {error && <p className="inline-warning">{error}</p>}
        {can("sync") && (
          <button
            className="primary"
            disabled={busy}
            onClick={() => action(() => api("/sync", {}), "Sincronização concluída. Dados locais preservados.")}
          >
            <RefreshCw size={16} /> Sincronizar agora
          </button>
        )}
        <p className="muted">
          A importação registra organizações com CNPJ válido e razão social informada, aguardando classificação na seção Organizações.
          Cada chamado real cria uma demanda em Recebido. Organização, tipo, responsável, prazo e matriz são conferidos dentro da demanda antes de avançar. Anexar o documento assinado e encerrar o chamado continuam no GLPI.
        </p>
        <h3>Histórico de sincronização</h3>
        {(data.sync || []).slice(0, 5).map((s: any) => (
          <div className="report-row" key={s.id}>
            <span className={s.status === "Falha" ? "urgent" : "positive"}>{s.status}</span>
            <span>{s.message}</span>
          </div>
        ))}
        {!data.sync?.length && <p className="muted">Nenhuma sincronização registrada.</p>}
      </section>
      <div className="detail-grid">
        <section className="panel">
          <div className="panel-heading">
            <h2>Chamados importados</h2>
            <span className="counter">{tickets.length}</span>
          </div>
          {tickets.map((t) => (
            <button
              key={t.external_id}
              className={"ticket-row" + (t.external_id === selected ? " active" : "")}
              onClick={() => setSelected(t.external_id)}
            >
              <strong>#{t.external_id}</strong>
              <span>{t.analysis.fields.razaoSocial?.value || t.title}</span>
              <span className={"badge " + (t.state === "vinculado" ? "ok" : "warn")}>{stateLabel[t.state]}</span>
              <small>
                {t.analysis.suggestion.type || "Tipo não identificado"}
                {t.analysis.suggestion.subtype ? " • " + t.analysis.suggestion.subtype : ""} •{" "}
                {t.analysis.pendencies.length} pendência(s)
              </small>
            </button>
          ))}
          {!tickets.length && (
            <div className="empty">
              <Inbox />
              <h3>Nenhum chamado importado</h3>
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
  const [downloading, setDownloading] = useState("");
  const [downloadError, setDownloadError] = useState("");
  async function downloadAttachment(document: any) {
    setDownloading(document.id);
    setDownloadError("");
    try {
      const response = await fetch(`/api/glpi/tickets/${encodeURIComponent(ticket.external_id)}/documents/${encodeURIComponent(document.id)}/download`);
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw Error(body?.error || "Não foi possível baixar o anexo.");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = window.document.createElement("a");
      link.href = url;
      link.download = document.name || "anexo";
      window.document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error: any) { setDownloadError(error.message); }
    finally { setDownloading(""); }
  }
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
        {ticket.title} • Grupos: {ticket.groups.join(", ")} • {ticket.followups} resposta(s) • {ticket.versions} versão(ões)
        registradas
      </p>
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
      <p className="muted">
        Sugestão: {a.suggestion.type || "—"}
        {a.suggestion.subtype ? " / " + a.suggestion.subtype : ""} ({a.suggestion.basis || "sem base"}). Confirme
        antes de criar.
      </p>
      <h3>Anexos no GLPI</h3>
      {ticket.documents.length ? (
        ticket.documents.map((d: any) => (
          <div className="document glpi-attachment" key={d.id}>
            <FileText size={20} aria-hidden="true" />
            <div>
              <strong>{d.name}</strong>
              <small>{d.mime || "tipo não informado"} • arquivo original do GLPI</small>
            </div>
            {ticket.mode === "real" && can("files") && can("bank") && (
              <button className="secondary" disabled={!!downloading} onClick={() => downloadAttachment(d)}>
                <Download size={16} /> {downloading === d.id ? "Baixando…" : "Baixar anexo"}
              </button>
            )}
          </div>
        ))
      ) : (
        <p className="muted">{ticket.documentsAvailable ? "Nenhum anexo retornado." : "Anexos indisponíveis para o token."}</p>
      )}
      {downloadError && <p className="inline-warning" role="alert">{downloadError}</p>}
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
