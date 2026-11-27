import { test } from "node:test";
import assert from "node:assert/strict";
import { slaStatus, resolutionDays, slaSummary, glpiNow } from "../shared/demand-sla.js";
import { ticketDeadlines, ticketHash, type RawTicket } from "../server/glpi.js";

const now = "2026-11-27 16:00:00";

test("SLA usa o prazo calculado pelo GLPI para cada chamado", () => {
  assert.equal(slaStatus({ created: "2026-11-24 15:33:12", solved: "2026-11-27 10:16:15", slaDue: "2026-12-04 11:16:15" }, now), "Concluído no prazo");
  assert.equal(slaStatus({ solved: "2026-12-05 09:00:00", slaDue: "2026-12-04 11:16:15" }, now), "Concluído fora do prazo");
  assert.equal(slaStatus({ closed: "2026-11-20 09:00:00", slaDue: "2026-11-21 09:00:00" }, now), "Concluído no prazo", "fechado sem solução usa o fechamento");
  assert.equal(slaStatus({ slaDue: "2026-11-28 09:00:00" }, now), "Em aberto no prazo");
  assert.equal(slaStatus({ slaDue: "2026-11-27 15:59:59" }, now), "Em aberto com prazo vencido");
  assert.equal(slaStatus({ solved: "2026-11-27 10:00:00", slaDue: "" }, now), "Sem prazo no GLPI");
});

test("tempo até a solução em dias corridos, só para chamados concluídos", () => {
  assert.equal(resolutionDays({ created: "2026-11-24 12:00:00", solved: "2026-11-27 00:00:00" }), 2.5);
  assert.equal(resolutionDays({ created: "2026-11-24 12:00:00" }), undefined);
  assert.equal(resolutionDays({ solved: "2026-11-27 00:00:00" }), undefined);
});

test("resumo separa status, média, mediana e natureza", () => {
  const summary = slaSummary([
    { kind: "Aditivo", created: "2026-11-01 00:00:00", solved: "2026-11-02 00:00:00", slaDue: "2026-11-06 00:00:00" },
    { kind: "Aditivo", created: "2026-11-01 00:00:00", solved: "2026-11-11 00:00:00", slaDue: "2026-11-06 00:00:00" },
    { kind: "Contrato novo", created: "2026-11-01 00:00:00", solved: "2026-11-04 00:00:00", slaDue: "2026-11-06 00:00:00" },
    { kind: "Contrato novo", created: "2026-11-20 00:00:00", slaDue: "2026-11-25 00:00:00" },
  ], ["Contrato novo", "Aditivo", "Consultivo (revisão)"], now);
  assert.deepEqual(summary.byStatus, [
    { name: "Concluído no prazo", count: 2 }, { name: "Concluído fora do prazo", count: 1 }, { name: "Em aberto com prazo vencido", count: 1 },
  ]);
  assert.equal(summary.concluded, 3);
  assert.equal(summary.averageDays, 4.7);
  assert.equal(summary.medianDays, 3);
  assert.deepEqual(summary.byKind, [
    { name: "Contrato novo", total: 2, concluded: 1, averageDays: 3, late: 1 },
    { name: "Aditivo", total: 2, concluded: 2, averageDays: 5.5, late: 1 },
  ]);
});

test("datas do GLPI entram no chamado sem alterar o que define mudança", () => {
  assert.deepEqual(ticketDeadlines({ solvedate: "2026-11-27 10:16:15", closedate: null, time_to_resolve: "2026-12-04 11:16:15", slas_id_ttr: "SOLUÇÃO - JURIDICO 5D" }),
    { solved: "2026-11-27 10:16:15", closed: "", slaDue: "2026-12-04 11:16:15", slaName: "SOLUÇÃO - JURIDICO 5D" });
  assert.deepEqual(ticketDeadlines({ slas_id_ttr: 0 }), { solved: "", closed: "", slaDue: "", slaName: "" });
  const ticket: RawTicket = { externalId: "1", title: "t", status: "2", created: "", updated: "", category: "", groups: [], content: "", followups: [], documents: [], documentsAvailable: true };
  assert.equal(ticketHash({ ...ticket, solved: "2026-11-27 10:16:15", slaDue: "2026-12-04 11:16:15" }), ticketHash(ticket));
  assert.match(glpiNow(new Date("2026-11-27T19:00:00Z")), /^2026-11-27 16:00:00$/);
});
