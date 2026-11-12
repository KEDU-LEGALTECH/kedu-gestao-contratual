import { db, one, all, run, id, now, audit, sql, auditAsync } from "./db.js";
import { DemoTicketSource, RealGlpiSource, glpiConfig, configProblems, ticketHash, type TicketSource, type RawTicket } from "./glpi.js";
import { analyzeTicket } from "./glpi-analysis.js";
import {conversationExpectations,conversationText,conversationEntries} from './request-expectations.js';
import { importGlpiSchools } from "./glpi-schools.js";
import { organizations } from "./organizations.js";
import { receiveGlpiDemands } from "./glpi-intake.js";
import { scheduleContractProcessing } from "./contract-processing.js";
import {dailySyncTimes,latestDueSlot,scheduleTimezone} from './glpi-schedule.js';

export async function ticketSource(): Promise<TicketSource> {
  if (process.env.GLPI_MODE !== "real") return new DemoTicketSource();
  const previous = new Map<string, RawTicket>();
  const rows = await sql.all("SELECT external_id,payload FROM glpi_tickets WHERE mode='real'");
  for (const row of rows) {
    try {
      const current: RawTicket = JSON.parse(row.payload);
      if (current.documentsAvailable === false && !current.documents.length && !current.followups.length) {
        const known = await sql.one(`SELECT payload FROM glpi_ticket_versions WHERE external_id=?
          AND (json_array_length(payload, '$.documents') > 0 OR json_array_length(payload, '$.followups') > 0)
          ORDER BY seen DESC, rowid DESC LIMIT 1`, row.external_id);
        if (known) {
          const historical: RawTicket = JSON.parse(known.payload);
          current.documents = historical.documents;
          current.followups = historical.followups;
          current.documentLinks = historical.documentLinks;
          current.messageAuthors = historical.messageAuthors;
        }
      }
      previous.set(row.external_id, current);
    }
    catch { /* Reimport a ticket whose local payload cannot be read. */ }
  }
  return new RealGlpiSource(glpiConfig(), fetch, rows.map(t => t.external_id), previous);
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
async function context() {
  return {
    schools: await organizations(),
    matrices: await sql.all("SELECT id,school_id FROM contract_registry WHERE instrument_kind='Matriz' AND status='Assinado'"),
  };
}
let running = false;
let syncStartedAt:string|null=null;
/** Imports tickets into a staging table. Idempotent by ticket id + content hash.
 * External changes never overwrite local demands, data or approvals: they are recorded as a new
 * immutable version and flagged for human review. */
export async function syncGlpi(userId: string | null, source?: TicketSource, timeoutMs = 600000) {
  source ??= await ticketSource();
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
      await sql.run("INSERT INTO sync_logs VALUES(?,?,?,?,?)", id(), "Falha", 0, `${source.mode === "real" ? "GLPI" : "Demonstração"}: ${message}`.slice(0, 500), now());
      await auditAsync(null, userId, "Falha na sincronização GLPI (" + source.mode + ")");
      throw Error(message);
    }
    summary.read = tickets.length;
    const returned = new Set(tickets.map(ticket => ticket.externalId));
    const failures = [...new Set(source.failures)].filter(ticketId => !returned.has(ticketId));
    const reused = source.reused ?? 0;
    const ctx = await context();
    await sql.transaction(async () => {
      for (const ticket of tickets) {
        const hash = ticketHash(ticket);
        const payload = JSON.stringify(ticket);
        const analysis = JSON.stringify(analyzeTicket(ticket, ctx));
        const existing = await sql.one("SELECT * FROM glpi_tickets WHERE external_id=?", ticket.externalId);
        const stamp = now();
        if (!existing) {
          await sql.run("INSERT INTO glpi_tickets VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", ticket.externalId, source.mode, ticket.title.slice(0, 300), ticket.status, hash, payload, analysis, "novo", null, stamp, stamp, null);
          await sql.run("INSERT INTO glpi_ticket_versions VALUES(?,?,?,?,?)", id(), ticket.externalId, hash, payload, stamp);
          summary.created++;
        } else if (existing.hash === hash || existing.hash === ticketHash({...ticket, documentsAvailable: !ticket.documentsAvailable})) {
          // Coverage corrections alone are not a new document version and must not reset the reading queue.
          await sql.run("UPDATE glpi_tickets SET payload=?,analysis=?,last_seen=? WHERE external_id=?", payload, analysis, stamp, ticket.externalId);
          summary.unchanged++;
        } else {
          const state = existing.demand_id ? "alterado após vínculo" : "alterado";
          await sql.run("UPDATE glpi_tickets SET hash=?,payload=?,analysis=?,state=?,title=?,status=?,last_seen=?,changed_at=? WHERE external_id=?", hash, payload, analysis, state, ticket.title.slice(0, 300), ticket.status, stamp, stamp, ticket.externalId);
          await sql.run("INSERT OR IGNORE INTO glpi_ticket_versions VALUES(?,?,?,?,?)", id(), ticket.externalId, hash, payload, stamp);
          summary.changed++;
          if (existing.demand_id) {
            summary.linkedChanged++;
            await auditAsync(existing.demand_id, userId, `Chamado GLPI #${ticket.externalId} mudou após a importação; dados locais preservados — revise as alterações`);
          }
        }
      }
      if (source.mode === "real") summary.schools = await importGlpiSchools(userId, false);
      if (source.mode === "real") summary.demandsCreated = (await receiveGlpiDemands(userId, false)).created;
      await sql.run("INSERT INTO sync_logs VALUES(?,?,?,?,?)", id(), failures.length ? "Parcial" : "Concluído", summary.created, `${source.mode === "real" ? "GLPI (somente leitura)" : "Demonstração"}: ${summary.read} lidos, ${summary.created} novos, ${summary.changed} alterados (${summary.linkedChanged} já vinculados), ${summary.unchanged} sem alteração. Escolas: ${summary.schools.created} novas, ${summary.schools.conflicts} divergências de nome, ${summary.schools.skipped} chamados sem cadastro automático. Cadastros existentes preservados.` +
          (source.mode === "real" ? ` Linhas do tempo reaproveitadas: ${reused}. Aprovações com cobertura parcial: ${tickets.filter(t => t.approvalCoverage === "partial").length}.` : "") +
          (failures.length ? ` Chamados não atualizados: ${failures.length} (${failures.slice(0, 12).join(", ")}${failures.length > 12 ? ", …" : ""}).` : ""), now());
    });
    await auditAsync(null, userId, `Sincronização GLPI ${source.mode}: ${summary.created} novos, ${summary.changed} alterados`);
    if(source.mode==="real")await scheduleContractProcessing();
    return { ...summary, reused, failedTickets: failures };
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
export async function startSchedule() {
  const times = dailySyncTimes();
  if (times.length && process.env.NODE_ENV !== 'test') {
    const tick = async () => {
      const slot = latestDueSlot(new Date(), times);
      if (!slot || running) return;
      const due=new Date(slot+'-03:00').toISOString();
      const success=await sql.one("SELECT created FROM sync_logs WHERE status='Concluído' ORDER BY created DESC LIMIT 1");
      if(success?.created>=due)return;
      const key='glpiSyncSlot:'+slot,stamp=now();
      // A lease prevents simultaneous dispatch and permits retry after failure/restart.
      const claim=await sql.run("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE settings.value<?", key, stamp, new Date(Date.now()-10*60000).toISOString());
      if(!claim.changes)return;
      void syncGlpi(null).catch(() => { /* Failure remains visible; retry after ten minutes. */ });
    };
    const timer = setInterval(() => { tick().catch(error => console.error("Agendamento GLPI falhou:", error)); }, 15000);
    timer.unref();
    await tick();
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
export async function listTickets() {
  const ctx = await context();
  const versions = new Map((await sql.all("SELECT external_id,COUNT(*) n FROM glpi_ticket_versions GROUP BY external_id")).map(r => [r.external_id, r.n]));
  return (await sql.all("SELECT external_id,mode,title,status,state,demand_id,first_seen,last_seen,changed_at,analysis,payload FROM glpi_tickets ORDER BY first_seen DESC,external_id DESC")).map((t) => {
    const payload = JSON.parse(t.payload);
    const analysis=analyzeTicket(payload,ctx);
    return {
      ...t,
      payload: undefined,
      priority: payload.priority || "",
      // Re-analysed with the current registry (schools/matrices may have been registered since).
      analysis,
      reference:conversationExpectations(payload,analysis.fields),
      requestText:conversationText(payload),
      conversation:conversationEntries(payload),
      documents: payload.documents,
      documentsAvailable: payload.documentsAvailable,
      approvalCoverage: payload.approvalCoverage,
      followups: payload.followups.length,
      category: payload.category,
      groups: payload.groups,
      versions: versions.get(t.external_id) ?? 0,
    };
  });
}
