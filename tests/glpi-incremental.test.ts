import { test } from "node:test";
import assert from "node:assert/strict";
import { glpiConfig, RealGlpiSource, type RawTicket } from "../server/glpi.js";

test("GLPI reaproveita date_mod, isola chamado com falha e separa cobertura de aprovações", async () => {
  const calls: string[] = [];
  const cached: RawTicket = {
    externalId: "13", title: "Reaproveitado", status: "2", updated: "2026-11-05 15:00:00",
    created: "", category: "", groups: [], content: "", followups: [],
    documents: [{ id: "70", name: "preservado.pdf", mime: "", sha1: "" }],
    documentsAvailable: true, approvalCoverage: "complete", timelineCoverage: "complete",
  };
  const config = glpiConfig({ GLPI_URL: "https://fake.local/apirest.php", GLPI_GROUP_IDS: "21",
    GLPI_GROUPS: "", GLPI_APP_TOKEN: "fake-app", GLPI_USER_TOKEN: "fake-user", GLPI_RETRIES: "0" });
  const fake: typeof fetch = async input => {
    const path = new URL(String(input)).pathname.split("/apirest.php/")[1];
    calls.push(path);
    const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (path === "initSession") return response({ session_token: "fake" });
    if (path === "killSession") return response(true);
    if (path === "Group/21") return response({ name: "Jurídico" });
    if (path === "Group/21/Group_Ticket") return response([14, 13, 12, 11, 10].map(id => ({ tickets_id: id, groups_id: 21, type: 2 })));
    if (path === "Ticket/14") return response(["ERROR", "falha isolada"], 500);
    if (path === "Ticket/13") return response({ id: 13, date_mod: cached.updated, status: 5 });
    if (path === "Ticket/12") return response({ id: 12, global_validation: 1 });
    if (path === "Ticket/11") return response({ id: 11, global_validation: 2 });
    if (path === "Ticket/10") return response({ id: 10, global_validation: 1 });
    if (path === "Ticket/11/TicketValidation") return response(["ERROR_RIGHT_MISSING"], 403);
    if (path === "Ticket/10/ITILFollowup") return response(["ERROR_RIGHT_MISSING"], 403);
    if (path === "Ticket/11/Document_Item") return response([{ documents_id: 71 }]);
    if (path === "Document/71") return response({ filename: "disponível.pdf" });
    return response([]);
  };
  const previous = { ...cached, externalId: "10", followups: [{ id: "6", date: "", content: "Mensagem preservada", private: false }],
    documentLinks: { "6": ["70"] } };
  const source = new RealGlpiSource(config, fake, [], new Map([["13", cached], ["10", previous]]));
  const result = await source.read(AbortSignal.timeout(1000));
  assert.deepEqual(source.failures, ["14"]);
  assert.equal(source.reused, 1);
  assert.deepEqual(result.map(ticket => [ticket.externalId, ticket.documentsAvailable, ticket.approvalCoverage]), [
    ["13", true, "complete"], ["12", true, "not_required"], ["11", true, "partial"], ["10", false, "not_required"],
  ]);
  assert.equal(result[0].status, "5");
  assert.equal(result[0].documents[0].name, "preservado.pdf");
  assert.equal(result[2].documents[0].name, "disponível.pdf");
  assert.equal(result[3].documents[0].name, "preservado.pdf");
  assert.equal(result[3].followups[0].content, "Mensagem preservada");
  assert.ok(!calls.some(path => path.startsWith("Ticket/13/")));
  assert.ok(!calls.includes("Ticket/12/TicketValidation"));
});

test("chamado sem mudança, mas com aprovações antes recusadas, é lido de novo", async () => {
  const calls: string[] = [];
  const cached: RawTicket = {
    externalId: "20", title: "Aprovação recusada antes", status: "2", updated: "2026-11-05 15:00:00",
    created: "", category: "", groups: [], content: "", followups: [], documents: [],
    documentsAvailable: true, approvalCoverage: "partial", timelineCoverage: "complete",
  };
  const config = glpiConfig({ GLPI_URL: "https://fake.local/apirest.php", GLPI_GROUP_IDS: "21",
    GLPI_GROUPS: "", GLPI_APP_TOKEN: "fake-app", GLPI_USER_TOKEN: "novo-token", GLPI_RETRIES: "0" });
  const fake: typeof fetch = async input => {
    const path = new URL(String(input)).pathname.split("/apirest.php/")[1];
    calls.push(path);
    const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (path === "initSession") return response({ session_token: "fake" });
    if (path === "killSession") return response(true);
    if (path === "Group/21") return response({ name: "Jurídico" });
    if (path === "Group/21/Group_Ticket") return response([{ tickets_id: 20, groups_id: 21, type: 2 }]);
    if (path === "Ticket/20") return response({ id: 20, date_mod: cached.updated, status: 2, global_validation: 2 });
    if (path === "Ticket/20/TicketValidation") return response([{ id: 5, comment_submission: "Aprovar contrato", date_creation: "2026-11-05 14:00:00" }]);
    return response([]);
  };
  const source = new RealGlpiSource(config, fake, [], new Map([["20", cached]]));
  const [ticket] = await source.read(AbortSignal.timeout(1000));
  assert.equal(source.reused, 0);
  assert.ok(calls.includes("Ticket/20/TicketValidation"));
  assert.equal(ticket.approvalCoverage, "complete");
});
