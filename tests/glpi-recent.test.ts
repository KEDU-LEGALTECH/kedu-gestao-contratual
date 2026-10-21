import { test } from "node:test";
import assert from "node:assert/strict";
import { RealGlpiSource, glpiConfig } from "../server/glpi.js";

type Link = { id: number; tickets_id: number; groups_id: number; type: number };
function fixture(options: { ignoreSort?: boolean; serverPageSize?: number } = {}) {
  const groups: Record<number, Link[]> = {
    21: [
      ...Array.from({ length: 60 }, (_, i) => ({ id: i + 1000, tickets_id: i + 1, groups_id: 21, type: 2 })),
      ...Array.from({ length: 12 }, (_, i) => ({ id: i + 2000, tickets_id: 200 + i, groups_id: 21, type: 3 })),
      ...Array.from({ length: 6 }, (_, i) => ({ id: i + 2, tickets_id: 100, groups_id: 21, type: 2 })),
      { id: 1, tickets_id: 99, groups_id: 21, type: 2 },
    ],
    22: [
      { id: 9000, tickets_id: 98, groups_id: 22, type: 2 },
      { id: 2, tickets_id: 100, groups_id: 22, type: 2 },
      { id: 1, tickets_id: 101, groups_id: 22, type: 2 },
    ],
  };
  const calls: { path: string; method: string; query: URLSearchParams }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname.replace("/apirest.php/", "");
    calls.push({ path, method: init?.method || "GET", query: url.searchParams });
    const response = (body: unknown, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
    if (path === "initSession") return response({ session_token: "fake-session" });
    if (path === "killSession") return response(true);
    let match = /^Group\/(\d+)$/.exec(path);
    if (match) return response({ id: Number(match[1]), name: "Grupo " + match[1] });
    match = /^Group\/(\d+)\/Group_Ticket$/.exec(path);
    if (match) {
      assert.equal(url.searchParams.get("sort"), "tickets_id");
      assert.equal(url.searchParams.get("order"), "DESC");
      const links = [...groups[Number(match[1])]];
      if (!options.ignoreSort) links.sort((a, b) => b.tickets_id - a.tickets_id);
      const [start, requestedEnd] = url.searchParams.get("range")!.split("-").map(Number);
      const end = Math.min(requestedEnd, start + (options.serverPageSize || Infinity) - 1);
      const page = links.slice(start, end + 1);
      return response(page, end < links.length - 1 ? 206 : 200, { "Content-Range": `${start}-${start + page.length - 1}/${links.length}` });
    }
    match = /^Ticket\/(\d+)$/.exec(path);
    if (match) return response({ id: Number(match[1]), name: "Chamado fictício", content: "Conteúdo fictício", date_creation: "2026-10-20 10:00:00" });
    if (/^Ticket\/\d+\/(ITILFollowup|Document_Item)$/.test(path)) return response([]);
    throw Error("Recurso inesperado: " + path);
  };
  const config = glpiConfig({ GLPI_URL: "https://fake.local/apirest.php", GLPI_APP_TOKEN: "fake-app", GLPI_USER_TOKEN: "fake-user", GLPI_GROUP_IDS: "21;22", GLPI_GROUPS: "", GLPI_MAX_TICKETS: "2", GLPI_PAGE_SIZE: "5", GLPI_RETRIES: "0" });
  return { source: new RealGlpiSource(config, fetchImpl), calls };
}

test("Seleciona recentes antes do limite, pagina observadores/duplicados e une os grupos", async () => {
  const { source, calls } = fixture();
  const tickets = await source.read(AbortSignal.timeout(10000));
  assert.deepEqual(tickets.map(t => t.externalId), ["101", "100"]);
  assert.deepEqual(tickets[1].groups, ["Grupo 21", "Grupo 22"]);
  assert.ok(calls.filter(c => c.path === "Group/21/Group_Ticket").length >= 4);
  assert.deepEqual(calls.filter(c => /^Ticket\/\d+$/.test(c.path)).map(c => c.path), ["Ticket/101", "Ticket/100"]);
  assert.ok(calls.every(c => c.method === "GET"));
  assert.equal(calls.at(-1)?.path, "killSession");
});

test("Recusa ordem incorreta do servidor sem buscar documentos ou entregar lote parcial", async () => {
  const { source, calls } = fixture({ ignoreSort: true });
  await assert.rejects(source.read(AbortSignal.timeout(10000)), /não respeitou a ordenação/);
  assert.ok(!calls.some(c => c.path.startsWith("Ticket/")));
  assert.equal(calls.at(-1)?.path, "killSession");
});

test("Content-Range permite continuar quando o servidor reduz o tamanho da página", async () => {
  const { source, calls } = fixture({ serverPageSize: 2 });
  const tickets = await source.read(AbortSignal.timeout(10000));
  assert.deepEqual(tickets.map(t => t.externalId), ["101", "100"]);
  const pages = calls.filter(c => c.path === "Group/21/Group_Ticket");
  assert.equal(pages[1].query.get("range"), "2-6");
});
