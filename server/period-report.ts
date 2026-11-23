import { sql } from "./db.js";

/** What changed in a period: GLPI status movements (from the stored ticket versions) and portal
 * events (from the audit log). Dates are grouped in Brasília time by day, week or month. */
export const changeKinds: Record<string, string> = {
  novo: "Chamados novos",
  andamento_pendente: "Em andamento → Pendente",
  pendente_andamento: "Pendente → Em andamento",
  solucionado: "Solucionados no GLPI",
  fechado: "Fechados no GLPI",
  reaberto: "Reabertos no GLPI",
  finalizado: "Finalizados no portal",
  divergencia: "Divergências aceitas",
  conferencia: "Mudanças de área na conferência",
};
type Group = "day" | "week" | "month";
const brasilia = (iso: string) => new Date(new Date(iso).getTime() - 3 * 3600000).toISOString().slice(0, 10);
function bucket(day: string, group: Group) {
  if (group === "month") return day.slice(0, 7);
  if (group === "day") return day;
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
const working = (s: string) => ["1", "2", "3"].includes(s);
function glpiKind(before: string | undefined, after: string) {
  if (before === undefined) return "novo";
  if (before === after) return "";
  if (after === "5") return "solucionado";
  if (after === "6") return before === "5" ? "" : "fechado";
  if (["5", "6"].includes(before)) return "reaberto";
  if (working(before) && after === "4") return "andamento_pendente";
  if (before === "4" && working(after)) return "pendente_andamento";
  return "";
}
// A solved ticket that is later closed counts once, as solved; the closing itself is not a new resolution.
export async function periodChanges(user: any, from: string, to: string, group: Group) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw Error("Período inválido.");
  const demands = new Map((await sql.all("SELECT d.id,d.glpi_id,d.owner,COALESCE(s.name,'') AS school,t.title FROM demands d LEFT JOIN schools s ON s.id=d.school_id LEFT JOIN glpi_tickets t ON t.external_id=d.glpi_id")).map((d: any) => [d.id, d]));
  const byTicket = new Map([...demands.values()].filter((d: any) => d.glpi_id).map((d: any) => [String(d.glpi_id), d]));
  const visible = (d: any) => !!d && (user.role !== "Solicitante" || d.owner === user.id);
  const events: any[] = [];
  const versions = await sql.all("SELECT external_id,seen,json_extract(payload,'$.status') AS status FROM glpi_ticket_versions ORDER BY external_id,seen");
  let previous: any = null;
  for (const v of versions) {
    const before = previous?.external_id === v.external_id ? String(previous.status) : undefined;
    const kind = glpiKind(before, String(v.status));
    previous = v;
    const d = byTicket.get(String(v.external_id));
    if (kind && visible(d)) events.push({ kind, at: v.seen, demandId: d.id, glpiId: d.glpi_id, school: d.school || d.title });
  }
  const audits = await sql.all("SELECT demand_id,action,created FROM audit WHERE demand_id IS NOT NULL AND (action LIKE 'Demanda finalizada manualmente%' OR action LIKE 'Divergência aceita%' OR action LIKE 'Conferência: %')");
  for (const a of audits) {
    const d = demands.get(a.demand_id);
    if (!visible(d)) continue;
    const kind = a.action.startsWith("Demanda finalizada") ? "finalizado" : a.action.startsWith("Divergência") ? "divergencia" : "conferencia";
    events.push({ kind, at: a.created, demandId: d.id, glpiId: d.glpi_id, school: d.school || d.title, detail: a.action.slice(0, 300) });
  }
  const inPeriod = events.map(e => ({ ...e, day: brasilia(e.at) })).filter(e => e.day >= from && e.day <= to).sort((a, b) => b.at.localeCompare(a.at));
  const buckets = new Map<string, Record<string, number>>();
  for (const e of inPeriod) {
    const key = bucket(e.day, group), counts = buckets.get(key) || {};
    counts[e.kind] = (counts[e.kind] || 0) + 1;
    buckets.set(key, counts);
  }
  const totals: Record<string, number> = {};
  for (const e of inPeriod) totals[e.kind] = (totals[e.kind] || 0) + 1;
  return {
    kinds: changeKinds,
    totals,
    buckets: [...buckets.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([key, counts]) => ({ key, counts })),
    events: inPeriod.slice(0, 1000),
    truncated: inPeriod.length > 1000,
    // Area changes are recorded from this version on; earlier periods only have GLPI and portal events.
    areaHistorySince: (await sql.one("SELECT MIN(created) AS first FROM audit WHERE action LIKE 'Conferência: %'"))?.first || null,
  };
}
