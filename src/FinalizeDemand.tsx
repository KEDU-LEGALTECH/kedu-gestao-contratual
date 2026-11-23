import { useEffect, useState } from "react";

/** Last block of a demand: mark it as finished when it was resolved outside the portal, or reopen it. */
export function FinalizeDemand({ did, stage, can, api, action, busy }: any) {
  const [info, setInfo] = useState<any>(null);
  useEffect(() => { api(`/demands/${did}/finalization`).then(setInfo).catch(() => setInfo(null)); }, [did, stage]);
  if (!info) return null;
  const done = info.finalization;
  if (done && stage === "Concluído") return <section className="panel simple-source">
   <h2>Demanda finalizada</h2>
   <p><strong>{done.outcome}</strong> · {new Date(done.at).toLocaleString("pt-BR")} · {done.by}</p>
   <p>{done.reason}</p>
   {can("settings") && <button type="button" className="secondary" disabled={busy}
    onClick={() => action(() => api(`/demands/${did}/reopen`, {}), "Demanda reaberta.")}>Reabrir demanda</button>}
  </section>;
  if (["Concluído", "Cancelado"].includes(stage) || !(can("write") || can("legal"))) return null;
  return <details className="panel fold">
   <summary><strong>Finalizar demanda</strong><small>Quando já foi resolvida fora do portal</small></summary>
   <p className="muted">Use quando a demanda já foi resolvida, por exemplo no GLPI, sem passar pelo portal. Ela sai das listas de pendências e o motivo fica registrado na auditoria.</p>
   <form onSubmit={e => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    action(() => api(`/demands/${did}/finalize`, { outcome: f.get("outcome"), reason: f.get("reason") }), "Demanda finalizada.");
   }}>
    <label>Como foi resolvida<select name="outcome" required defaultValue="">
     <option value="" disabled>Selecione</option>
     {info.outcomes.map((o: string) => <option key={o}>{o}</option>)}
    </select></label>
    <label>Motivo<textarea name="reason" required minLength={5} maxLength={1000} rows={2} placeholder="Ex.: contrato assinado e enviado pelo GLPI em 18/11."/></label>
    <label><input type="checkbox" required/> Conferi que esta demanda não precisa de mais nenhuma ação no portal</label>
    <button className="primary" disabled={busy}>Finalizar demanda</button>
   </form>
  </details>;
}
