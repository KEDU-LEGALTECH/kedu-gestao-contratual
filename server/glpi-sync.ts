import { db, one, all, run, id, now, audit } from "./db.js";
import { DemoTicketSource, RealGlpiSource, glpiConfig, configProblems, ticketHash, type TicketSource, type RawTicket } from "./glpi.js";
import { analyzeTicket,htmlToText } from "./glpi-analysis.js";
import {requestExpectations} from './request-expectations.js';
import { importGlpiSchools } from "./glpi-schools.js";
import { organizations } from "./organizations.js";
import { receiveGlpiDemands } from "./glpi-intake.js";
import { scheduleContractProcessing } from "./contract-processing.js";
import {dailySyncTimes,latestDueSlot,scheduleTimezone} from './glpi-schedule.js';

export function ticketSource(): TicketSource {
  return process.env.GLPI_MODE === "real" ? new RealGlpiSource(glpiConfig(),fetch,all("SELECT external_id FROM glpi_tickets WHERE mode='real' AND status IN ('1','2','3','4','5')").map(t=>t.external_id)) : new DemoTicketSource();
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
    dailyTimes: dailySyncTimes(),
    scheduleTimezone,
    readOnly: true,
    running,
    startedAt: syncStartedAt,
  };
}
function context() {
  return {
    schools: organizations(),
    matrices: all("SELECT id,school_id FROM contract_registry WHERE instrument_kind='Matriz' AND status='Assinado'"),
  };
}
let running = false;
let syncStartedAt:string|null=null;
/** Imports tickets into a staging table. Idempotent by ticket id + content hash.
 * External changes never overwrite local demands, data or approvals: they are recorded as a new
 * immutable version and flagged for human review. */
export async function syncGlpi(userId: string | null, source = ticketSource(), timeoutMs = 600000) {
  if (running) throw Error("Já existe uma sincronização em andamento.");
  running = true;
  syncStartedAt=now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const summary = { read: 0, created: 0, changed: 0, unchanged: 0, linkedChanged: 0, demandsCreated: 0, schools: { created: 0, matched: 0, skipped: 0, conflicts: 0 } };
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
      if (source.mode === "real") summary.schools = importGlpiSchools(userId, false);
      if (source.mode === "real") summary.demandsCreated = receiveGlpiDemands(userId, false).created;
      run(
        "INSERT INTO sync_logs VALUES(?,?,?,?,?)",
        id(),
        "Concluído",
        summary.created,
        `${source.mode === "real" ? "GLPI (somente leitura)" : "Demonstração"}: ${summary.read} lidos, ${summary.created} novos, ${summary.changed} alterados (${summary.linkedChanged} já vinculados), ${summary.unchanged} sem alteração. Escolas: ${summary.schools.created} novas, ${summary.schools.conflicts} divergências de nome, ${summary.schools.skipped} chamados sem cadastro automático. Cadastros existentes preservados.`,
        now(),
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    audit(null, userId, `Sincronização GLPI ${source.mode}: ${summary.created} novos, ${summary.changed} alterados`);
    if(source.mode==="real")scheduleContractProcessing();
    return summary;
  } finally {
    clearTimeout(timer);
    running = false;
    syncStartedAt=null;
  }
}
export function scheduleMinutes() {
  const n = Number(process.env.GLPI_SYNC_INTERVAL_MINUTES || 0);
  return Number.isInteger(n) && n >= 5 && n <= 1440 ? n : 0;
}
/** Daily slots in Brasilia time take precedence over the optional interval.
 * Changes to GLPI_SYNC_TIMES are loaded when the backend restarts. */
export function startSchedule() {
  const times = dailySyncTimes();
  if (times.length && process.env.NODE_ENV !== 'test') {
    const tick = () => {
      const slot = latestDueSlot(new Date(), times);
      if (!slot || running) return;
      const due=new Date(slot+'-03:00').toISOString();
      const success=one("SELECT created FROM sync_logs WHERE status='Concluído' ORDER BY created DESC LIMIT 1");
      if(success?.created>=due)return;
      const key='glpiSyncSlot:'+slot,stamp=now();
      // A lease prevents simultaneous dispatch and permits retry after failure/restart.
      const claim=run("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE settings.value<?",key,stamp,new Date(Date.now()-10*60000).toISOString());
      if(!claim.changes)return;
      void syncGlpi(null).catch(() => { /* Failure remains visible; retry after ten minutes. */ });
    };
    const timer = setInterval(tick, 15000);
    timer.unref();
    tick();
    return timer;
  }
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
    const analysis=analyzeTicket(payload,ctx);
    return {
      ...t,
      payload: undefined,
      priority: payload.priority || "",
      // Re-analysed with the current registry (schools/matrices may have been registered since).
      analysis,
      reference:requestExpectations(payload.content,analysis.fields),
      requestText:htmlToText(payload.content).join("\n"),
      documents: payload.documents,
      documentsAvailable: payload.documentsAvailable,
      followups: payload.followups.length,
      category: payload.category,
      groups: payload.groups,
      versions: one("SELECT COUNT(*) n FROM glpi_ticket_versions WHERE external_id=?", t.external_id).n,
    };
  });
}
