/** Solution deadline (SLA) as configured in the Kedu GLPI ("SOLUÇÃO - JURIDICO 5D"): the portal reads the
 * deadline GLPI computed for each ticket (time_to_resolve) and never calculates its own business days.
 * GLPI dates are local "YYYY-MM-DD HH:MM:SS" strings, so they compare as text. */
export const slaStatuses = ["Concluído no prazo", "Concluído fora do prazo", "Em aberto no prazo", "Em aberto com prazo vencido", "Sem prazo no GLPI"] as const;
export type SlaStatus = (typeof slaStatuses)[number];
export type TicketDates = { created?: string | null; solved?: string | null; closed?: string | null; slaDue?: string | null };

const valid = (s: unknown) => (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(String(s ?? "")) ? String(s).slice(0, 19) : "");

/** Current time in the same local format GLPI uses (Fortaleza and São Paulo share UTC-3). */
export function glpiNow(date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Fortaleza", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .formatToParts(date).map(part => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** Solution date: GLPI's solution, or the closing date for tickets closed without a solution. */
export const concludedAt = (t: TicketDates) => valid(t.solved) || valid(t.closed);

export function slaStatus(t: TicketDates, now = glpiNow()): SlaStatus {
  const due = valid(t.slaDue), done = concludedAt(t);
  if (!due) return "Sem prazo no GLPI";
  if (done) return done <= due ? "Concluído no prazo" : "Concluído fora do prazo";
  return now <= due ? "Em aberto no prazo" : "Em aberto com prazo vencido";
}

/** Calendar days from opening to solution, with one decimal; undefined while open. */
export function resolutionDays(t: TicketDates): number | undefined {
  const start = valid(t.created), end = concludedAt(t);
  if (!start || !end) return undefined;
  const ms = Date.parse(end.replace(" ", "T") + "Z") - Date.parse(start.replace(" ", "T") + "Z");
  return ms >= 0 ? Math.round(ms / 8640000) / 10 : undefined;
}

export function slaSummary(rows: (TicketDates & { kind?: string })[], kinds: readonly string[], now = glpiNow()) {
  const days = (list: typeof rows) => list.map(resolutionDays).filter((d): d is number => d !== undefined);
  const average = (values: number[]) => (values.length ? Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10 : null);
  const median = (values: number[]) => {
    if (!values.length) return null;
    const s = [...values].sort((a, b) => a - b), m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 10) / 10;
  };
  const all = days(rows);
  return {
    byStatus: slaStatuses.map(name => ({ name, count: rows.filter(r => slaStatus(r, now) === name).length })).filter(r => r.count),
    concluded: all.length,
    averageDays: average(all),
    medianDays: median(all),
    byKind: kinds.map(name => {
      const list = rows.filter(r => r.kind === name), d = days(list);
      return { name, total: list.length, concluded: d.length, averageDays: average(d), late: list.filter(r => /prazo vencido|fora do prazo/.test(slaStatus(r, now))).length };
    }).filter(r => r.total),
  };
}
