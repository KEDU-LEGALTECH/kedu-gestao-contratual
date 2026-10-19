import { db, one, all, run, id, now, audit } from "./db.js";
import { DemoTicketSource, RealGlpiSource, glpiConfig, configProblems, ticketHash, type TicketSource, type RawTicket } from "./glpi.js";
import { analyzeTicket } from "./glpi-analysis.js";

export function ticketSource(): TicketSource {
  return process.env.GLPI_MODE === "real" ? new RealGlpiSource(glpiConfig()) : new DemoTicketSource();
}
export function glpiStatus() {
  const config = glpiConfig();
  const mode = process.env.GLPI_MODE === "real" ? "real" : "demo";
  return {
    mode,
    url: mode === "real" ? config.url : "",
    groups: config.groupIds.length ? config.groupIds.map(String) : config.groups,
    problems: mode === "real" ? configProblems(config) : [],
    intervalMinutes: scheduleMinutes(),
    readOnly: true,
  };
}
function context() {
  return {
    schools: all("SELECT id,cnpj,legal_name FROM schools"),
    matrices: all("SELECT id,school_id FROM contracts WHERE parent_id IS NULL AND status='Assinado'"),
  };
}
let running = false;
/** Imports tickets into a staging table. Idempotent by ticket id + content hash.
 * External changes never overwrite local demands, data or approvals: they are recorded as a new
 * immutable version and flagged for human review. */
export async function syncGlpi(userId: string | null, source = ticketSource(), timeoutMs = 120000) {
  if (running) throw Error("Já existe uma sincronização em andamento.");
  running = true;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const summary = { read: 0, created: 0, changed: 0, unchanged: 0, linkedChanged: 0 };
  try {
    let tickets: RawTicket[];
    try {
      tickets = await source.read(controller.signal);
    } catch (error: any) {
      const message = controller.signal.aborted ? "Tempo limite da sincronização excedido." : error.message;
      run("INSERT INTO sync_logs VALUES(?,?,?,?,?)", id(), "Falha", 0, `${source.mode === "real" ? "GLPI" : "Demonstração"}: ${message}`.slice(0, 500), now());
      audit(null, userId, "Falha na sincronização GLPI (" + source.mode + ")");
      throw Error(message);
    }
    summary.read = tickets.length;
    const ctx = context();
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const ticket of tickets) {
        const hash = ticketHash(ticket);
        const payload = JSON.stringify(ticket);
        const analysis = JSON.stringify(analyzeTicket(ticket, ctx));
        const existing = one("SELECT * FROM glpi_tickets WHERE external_id=?", ticket.externalId);
        const stamp = now();
        if (!existing) {
          run(
            "INSERT INTO glpi_tickets VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            ticket.externalId, source.mode, ticket.title.slice(0, 300), ticket.status, hash, payload, analysis, "novo", null, stamp, stamp, null,
          );
          run("INSERT INTO glpi_ticket_versions VALUES(?,?,?,?,?)", id(), ticket.externalId, hash, payload, stamp);
          summary.created++;
        } else if (existing.hash === hash) {
          run("UPDATE glpi_tickets SET last_seen=? WHERE external_id=?", stamp, ticket.externalId);
          summary.unchanged++;
        } else {
          const state = existing.demand_id ? "alterado após vínculo" : "alterado";
          run(
            "UPDATE glpi_tickets SET hash=?,payload=?,analysis=?,state=?,title=?,status=?,last_seen=?,changed_at=? WHERE external_id=?",
            hash, payload, analysis, state, ticket.title.slice(0, 300), ticket.status, stamp, stamp, ticket.externalId,
          );
          run("INSERT OR IGNORE INTO glpi_ticket_versions VALUES(?,?,?,?,?)", id(), ticket.externalId, hash, payload, stamp);
          summary.changed++;
          if (existing.demand_id) {
            summary.linkedChanged++;
            audit(existing.demand_id, userId, `Chamado GLPI #${ticket.externalId} mudou após a importação; dados locais preservados — revise as alterações`);
          }
        }
      }
      run(
        "INSERT INTO sync_logs VALUES(?,?,?,?,?)",
        id(),
        "Concluído",
        summary.created,
        `${source.mode === "real" ? "GLPI (somente leitura)" : "Demonstração"}: ${summary.read} lidos, ${summary.created} novos, ${summary.changed} alterados (${summary.linkedChanged} já vinculados), ${summary.unchanged} sem alteração. Dados locais preservados.`,
        now(),
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    audit(null, userId, `Sincronização GLPI ${source.mode}: ${summary.created} novos, ${summary.changed} alterados`);
    return summary;
  } finally {
    clearTimeout(timer);
    running = false;
  }
}
export function scheduleMinutes() {
  const n = Number(process.env.GLPI_SYNC_INTERVAL_MINUTES || 0);
  return Number.isInteger(n) && n >= 5 && n <= 1440 ? n : 0;
}
/** Optional periodic read; disabled unless GLPI_SYNC_INTERVAL_MINUTES is between 5 and 1440. */
export function startSchedule() {
  const minutes = scheduleMinutes();
  if (!minutes || process.env.NODE_ENV === "test") return null;
  const timer = setInterval(() => {
    syncGlpi(null).catch(() => {
      /* Failure is recorded in sync_logs. */
    });
  }, minutes * 60000);
  timer.unref();
  return timer;
}
export function listTickets() {
  const ctx = context();
  return all(
    "SELECT external_id,mode,title,status,state,demand_id,first_seen,last_seen,changed_at,analysis,payload FROM glpi_tickets ORDER BY first_seen DESC,external_id DESC",
  ).map((t) => {
    const payload = JSON.parse(t.payload);
    return {
      ...t,
      payload: undefined,
      // Re-analysed with the current registry (schools/matrices may have been registered since).
      analysis: analyzeTicket(payload, ctx),
      documents: payload.documents,
      documentsAvailable: payload.documentsAvailable,
      followups: payload.followups.length,
      category: payload.category,
      groups: payload.groups,
      versions: one("SELECT COUNT(*) n FROM glpi_ticket_versions WHERE external_id=?", t.external_id).n,
    };
  });
}
