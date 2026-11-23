import { useEffect, useState } from "react";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const shift = (day: string, days: number) => { const d = new Date(day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const presets: Record<string, () => [string, string]> = {
  "Hoje": () => [today(), today()],
  "7 dias": () => [shift(today(), -6), today()],
  "30 dias": () => [shift(today(), -29), today()],
  "Este mês": () => [today().slice(0, 7) + "-01", today()],
};
const br = (day: string) => day.split("-").reverse().join("/");
const bucketLabel = (key: string, group: string) => group === "month" ? key.split("-").reverse().join("/") : group === "week" ? "Semana de " + br(key) : br(key);

/** What changed per day, week or month: GLPI movements and portal decisions, with the demands behind each number. */
export function PeriodChanges({ open, compact = false, onMore }: { open: (id: string) => void; compact?: boolean; onMore?: () => void }) {
  const [preset, setPreset] = useState(compact ? "7 dias" : "30 dias");
  const [[from, to], setRange] = useState<[string, string]>(presets[compact ? "7 dias" : "30 dias"]());
  const [group, setGroup] = useState("day"), [kind, setKind] = useState(""), [shown, setShown] = useState(30);
  const [data, setData] = useState<any>(null), [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    setError("");
    fetch(`/api/reports/changes?${new URLSearchParams({ from, to, group })}`, { signal: c.signal })
      .then(async r => { const b = await r.json(); if (!r.ok) throw Error(b.error); setData(b); })
      .catch(e => { if (e.name !== "AbortError") setError(e.message); });
    return () => c.abort();
  }, [from, to, group]);
  useEffect(() => setShown(30), [from, to, kind]);
  const kinds = data ? Object.keys(data.kinds).filter(k => data.totals[k]) : [];
  const events = (data?.events || []).filter((e: any) => !kind || e.kind === kind);
  const choose = (name: string) => { setPreset(name); if (presets[name]) setRange(presets[name]()); };
  return <section className="panel period-changes">
   <div className="panel-heading"><div><h2>O que mudou</h2><p className="muted">Movimentos dos chamados no GLPI e decisões registradas no portal.</p></div>{onMore && <button type="button" className="text-button" onClick={onMore}>Ver relatórios</button>}</div>
   <div className="period-controls">
    {[...Object.keys(presets), "Escolher datas"].map(name => <button key={name} type="button" className={preset === name ? "primary" : "secondary"} onClick={() => choose(name)}>{name}</button>)}
    {preset === "Escolher datas" && <><label>De<input type="date" value={from} max={to} onChange={e => setRange([e.target.value, to])} /></label><label>Até<input type="date" value={to} min={from} onChange={e => setRange([from, e.target.value])} /></label></>}
    {!compact && <label>Agrupar por<select value={group} onChange={e => setGroup(e.target.value)}><option value="day">Dia</option><option value="week">Semana</option><option value="month">Mês</option></select></label>}
   </div>
   {error && <p role="alert" className="inline-warning">{error}</p>}
   {!data ? <p className="muted">Carregando…</p> : <>
    <div className="period-totals" role="list">
     {kinds.length ? kinds.map(k => <button key={k} type="button" role="listitem" className={"period-total" + (kind === k ? " active" : "")} onClick={() => setKind(kind === k ? "" : k)}><strong>{data.totals[k]}</strong><span>{data.kinds[k]}</span></button>)
      : <p className="muted">Nenhuma mudança registrada entre {br(from)} e {br(to)}.</p>}
    </div>
    {!compact && !!data.buckets.length && <div className="table-scroll"><table>
     <thead><tr><th>{group === "month" ? "Mês" : group === "week" ? "Semana" : "Dia"}</th>{kinds.map(k => <th key={k}>{data.kinds[k]}</th>)}</tr></thead>
     <tbody>{data.buckets.map((b: any) => <tr key={b.key}><th scope="row">{bucketLabel(b.key, group)}</th>{kinds.map(k => <td key={k}>{b.counts[k] || "—"}</td>)}</tr>)}</tbody>
    </table></div>}
    {!compact && !!events.length && <details className="pending-groups" open={!!kind}>
     <summary>{kind ? data.kinds[kind] : "Todas as mudanças"} ({events.length}{data.truncated ? "+" : ""})</summary>
     <ul className="simple-issues">{events.slice(0, shown).map((e: any, i: number) => <li key={i}>
      <button type="button" className="text-button" onClick={() => open(e.demandId)}>{e.school || "Demanda"} · GLPI #{e.glpiId}</button>
      <p>{data.kinds[e.kind]}{e.detail && e.kind === "conferencia" ? ": " + e.detail.replace("Conferência: ", "") : ""}</p>
      <small>{new Date(e.at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</small>
     </li>)}</ul>
     {events.length > shown && <button type="button" className="secondary list-more" onClick={() => setShown(shown + 30)}>Mostrar mais</button>}
    </details>}
    {!compact && !data.areaHistorySince && <p className="muted">As mudanças de área na conferência começam a ser registradas a partir desta versão.</p>}
   </>}
  </section>;
}
