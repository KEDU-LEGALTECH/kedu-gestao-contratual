import React, { useEffect, useState } from "react";
import { Download, TriangleAlert, ChevronRight } from "lucide-react";
import { PeriodChanges } from "./PeriodChanges";
export function Reports({
  users,
  canExport,
  open,
}: {
  users: any[];
  canExport: boolean;
  open: (id: string) => void;
}) {
  const [from, setFrom] = useState(
      new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" })
        .format(new Date())
        .slice(0, 7) + "-01",
    ),
    [to, setTo] = useState(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
      }).format(new Date()),
    ),
    [owner, setOwner] = useState(""),
    [report, setReport] = useState<any>(),
    [error, setError] = useState("");
  const params = new URLSearchParams({ from, to, owner }).toString();
  useEffect(() => {
    const c = new AbortController();
    setReport(null);
    setError("");
    fetch("/api/reports?" + params, { signal: c.signal })
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw Error(b.error);
        setReport(b);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, [params]);
  return (
    <>
      <PeriodChanges open={open} />
      <section className="panel">
        <div className="panel-heading">
          <h2>Demandas criadas no período</h2>
          {canExport && (
            <a className="secondary" href={"/api/reports.csv?" + params}>
              <Download size={16} /> Exportar CSV filtrado
            </a>
          )}
        </div>
        <div className="filter-row">
          <label>
            De
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            Até
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <label>
            Responsável
            <select value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">Todos os responsáveis</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {!report && !error && <p role="status">Carregando relatório…</p>}
      {report && (
        <>
          <div className="metric-grid">
            {[
              ["Volume no período", report.volume, "Data de criação"],
              [
                "Prazos vencidos",
                report.overdue,
                "Abertas do período selecionado",
              ],
              [
                "Tempo médio",
                report.average + " dias",
                "Criação até conclusão",
              ],
              [
                "Demandas com pendências",
                report.divergences.length,
                "Leituras inconclusivas e divergências",
              ],
            ].map(([l, v, c]) => (
              <div className="metric" key={l}>
                <div>{l}</div>
                <strong>{v}</strong>
                <small>{c}</small>
              </div>
            ))}
          </div>
          <div className="two-columns">
            <section className="panel">
              <h2>Volume por responsável</h2>
              {report.byOwner.map((r: any) => (
                <div className="report-row" key={r.name}>
                  <span>{r.name}</span>
                  <strong>{r.count}</strong>
                </div>
              ))}
            </section>
            <section className="panel">
              <h2>Demandas por etapa</h2>
              {report.byStage.map((r: any) => (
                <div className="report-row" key={r.stage}>
                  <span>{r.stage}</span>
                  <strong>{r.count}</strong>
                </div>
              ))}
            </section>
          </div>
          <section className="panel">
            <div className="panel-heading">
              <h2>Pendências e divergências</h2>
              <TriangleAlert size={18} />
            </div>
            {report.divergences.length ? (
              report.divergences.map((r: any) => (
                <div className="report-row" key={r.id}>
                  <span>
                    {r.school} • {r.count} apontamentos • {r.status}
                  </span>
                  <button className="text-button" onClick={() => open(r.id)}>
                    Inspecionar <ChevronRight size={15} />
                  </button>
                </div>
              ))
            ) : (
              <p className="empty-text">
                Nenhuma pendência ou divergência registrada no período.
              </p>
            )}
          </section>
          {report.closedPendencies?.length > 0 && (
            <section className="panel">
              <h2>Chamados encerrados no GLPI com pendências de leitura ({report.closedPendencies.length})</h2>
              <p className="muted">Não contam como pendências ativas. A leitura registrada foi preservada.</p>
              {report.closedPendencies.map((r: any) => (
                <div className="report-row" key={r.id}>
                  <span>
                    {r.school} • {r.glpiStage} • {r.count} apontamentos • {r.status}
                  </span>
                  <button className="text-button" onClick={() => open(r.id)}>
                    Inspecionar <ChevronRight size={15} />
                  </button>
                </div>
              ))}
            </section>
          )}
          <section className="panel">
            <h2>Como os indicadores são calculados</h2>
            <p className="muted">
              O período filtra a data de criação em America/Sao_Paulo, com
              início e fim inclusivos. Vencidas: demandas abertas com prazo
              anterior a hoje, sem contar etapas Concluído e Cancelado nem
              chamados solucionados ou fechados no GLPI. Tempo médio: dias corridos
              entre criação e conclusão das demandas concluídas selecionadas.
              As etapas acompanham a lista de Demandas. Pendências: resultado atual
              da leitura e validação automática das demandas abertas; nos fluxos
              administrativos, última conferência da última versão, sem somar
              versões antigas.
            </p>
          </section>
        </>
      )}
    </>
  );
}
