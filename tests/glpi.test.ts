import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "kedu-glpi-")), "test.sqlite");
process.env.NODE_ENV = "test";
process.env.DEMO_SEED = "true";
const { default: app } = await import("../server/index.js");
const { one, all, run } = await import("../server/db.js");
const { RealGlpiSource, glpiConfig, configProblems } = await import("../server/glpi.js");
const { analyzeTicket, htmlToText, validCnpj } = await import("../server/glpi-analysis.js");
const { syncGlpi } = await import("../server/glpi-sync.js");

/** Minimal GLPI 10 apirest.php double: documented headers, range/Content-Range, sub-items. */
const APP = "app-token-de-teste",
  USER = "user-token-de-teste",
  SESSION = "sessao-de-teste";
const calls: { method: string; path: string; headers: IncomingMessage["headers"] }[] = [];
let killed = 0,
  delay = 0,
  failInit = false;
const groupTickets = Array.from({ length: 7 }, (_, i) => ({
  id: 100 + i,
  tickets_id: 2026101200 + i,
  groups_id: 21,
  type: i === 6 ? 3 : 2, // the last one only observes
}));
const content =
  "&lt;p&gt;&lt;b&gt;RAZÃO SOCIAL:&lt;/b&gt; Escola Exemplo Ltda.&lt;/p&gt;&lt;p&gt;&lt;b&gt;CNPJ:&lt;/b&gt; 11.444.777/0001- 61&lt;/p&gt;" +
  "&lt;p&gt;&lt;b&gt;MOTIVO DO ADITIVO:&lt;/b&gt; Alteração de data da vigência de contrato&lt;/p&gt;" +
  "&lt;p&gt;&lt;b&gt;OBSERVAÇÕES OU CONSIDERAÇÕES ADICIONAIS:&lt;/b&gt; O início de contrato precisa ser alterado de Outubro/2026 para Novembro/2026.&lt;/p&gt;" +
  "&lt;p&gt;&lt;b&gt;ANEXOS:&lt;/b&gt; Documento anexado&lt;/p&gt;";
function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}
const glpi = createServer(async (req, res) => {
  const url = new URL(req.url!, "http://x");
  const path = url.pathname.replace(/^\/apirest\.php\//, "");
  calls.push({ method: req.method!, path, headers: req.headers });
  if (delay) await new Promise((r) => setTimeout(r, delay));
  if (req.headers["app-token"] !== APP) return send(res, 400, ["ERROR_APP_TOKEN_PARAMETERS_MISSING", "App-Token ausente"]);
  if (path === "initSession") {
    if (failInit || req.headers.authorization !== "user_token " + USER)
      return send(res, 401, ["ERROR_GLPI_LOGIN_USER_TOKEN", "token " + USER + " inválido"]);
    return send(res, 200, { session_token: SESSION });
  }
  if (req.headers["session-token"] !== SESSION) return send(res, 401, ["ERROR_SESSION_TOKEN_INVALID", "inválida"]);
  if (path === "killSession") {
    killed++;
    return send(res, 200, true);
  }
  const range = /^(\d+)-(\d+)$/.exec(url.searchParams.get("range") || "0-49")!;
  const page = (items: any[]) => {
    const [a, b] = [Number(range[1]), Number(range[2])];
    if (a >= items.length && items.length) return send(res, 400, ["ERROR_RANGE_EXCEED_TOTAL", "range"]);
    const slice = items.slice(a, b + 1);
    const partial = b + 1 < items.length;
    send(res, partial ? 206 : 200, slice, {
      "Content-Range": `${a}-${a + Math.max(slice.length - 1, 0)}/${items.length}`,
      "Accept-Range": "Group_Ticket 1000",
    });
  };
  if (path === "Group") {
    const name = url.searchParams.get("searchText[name]");
    return page(
      [
        { id: 21, name: "JURIDICO CONTRATOS", completename: "JURIDICO CONTRATOS" },
        { id: 22, name: "JURIDICO REVISÃO", completename: "JURIDICO REVISÃO" },
        { id: 23, name: "JURIDICO CONTRATOS ANTIGO", completename: "JURIDICO CONTRATOS ANTIGO" },
      ].filter((g) => g.name.includes(String(name))),
    );
  }
  if (path === "Group/21/Group_Ticket") return page(groupTickets);
  if (path === "Group/22/Group_Ticket") return page([]);
  let m = /^Ticket\/(\d+)$/.exec(path);
  if (m)
    return send(res, 200, {
      id: Number(m[1]),
      name: "JURIDICO : SOLICITAÇÃO DE ADITIVO DE CONTRATO PARA ESCOLAS",
      status: 2,
      date: "2026-10-16 10:58:00",
      date_mod: "2026-10-16 11:00:00",
      itilcategories_id: "MeF advogados > Juridico > CONTRATOS",
      content,
    });
  m = /^Ticket\/(\d+)\/ITILFollowup$/.exec(path);
  if (m) return page([{ id: 1, date: "2026-10-16 12:00:00", content: "Resposta pública", is_private: 0 }]);
  m = /^Ticket\/(\d+)\/Document_Item$/.exec(path);
  if (m) return Number(m[1]) === 2026101201 ? send(res, 403, ["ERROR_RIGHT_MISSING", "sem direito"]) : page([{ id: 9, documents_id: 501 }]);
  if (path === "Document/501")
    return send(res, 200, { id: 501, filename: "PRIMEIRO ADITIVO - ESCOLA.pdf", mime: "application/pdf", sha1sum: "abc" });
  send(res, 404, ["ERROR_ITEM_NOT_FOUND", path]);
});
glpi.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => glpi.on("listening", resolve));
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.on("listening", resolve));
after(() => {
  glpi.close();
  server.close();
});
const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
const config = (over: Record<string, string> = {}) =>
  glpiConfig({
    GLPI_URL: `http://127.0.0.1:${(glpi.address() as any).port}/apirest.php`,
    GLPI_APP_TOKEN: APP,
    GLPI_USER_TOKEN: USER,
    GLPI_PAGE_SIZE: "5",
    GLPI_TIMEOUT_MS: "1000",
    GLPI_RETRIES: "1",
    ...over,
  });
async function request(path: string, body?: any, cookie = "") {
  const res = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json(), cookie: res.headers.get("set-cookie")?.split(";")[0] || "" };
}
const admin = (await request("/login", { email: "admin@demo.kedu.local", password: "Kedu-demo-2026!" })).cookie;

test("Configuração exige HTTPS, tokens e grupos, sem expor segredos", () => {
  assert.deepEqual(configProblems(config()), []);
  assert.ok(configProblems(glpiConfig({ GLPI_URL: "http://helpdesk.kedu.com.br/apirest.php" })).length >= 3);
  assert.deepEqual(glpiConfig({}).groups, ["JURIDICO CONTRATOS", "JURIDICO REVISÃO"]);
  assert.deepEqual(glpiConfig({}).actorTypes, [2]);
});

test("Adaptador real lê somente GET, pagina, filtra grupos e tipo de ator e encerra a sessão", async () => {
  calls.length = 0;
  killed = 0;
  const tickets = await new RealGlpiSource(config()).read(new AbortController().signal);
  assert.equal(tickets.length, 6, "o chamado em que o grupo só observa fica fora");
  assert.ok(calls.every((c) => c.method === "GET"));
  assert.equal(killed, 1);
  assert.ok(calls.filter((c) => c.path === "Group/21/Group_Ticket").length >= 2, "paginação por range");
  assert.ok(calls.filter((c) => c.path !== "initSession").every((c) => c.headers["session-token"] === SESSION));
  assert.equal(calls.find((c) => c.path === "initSession")!.headers.authorization, "user_token " + USER);
  const withoutRights = tickets.find((t) => t.externalId === "2026101201")!;
  assert.equal(withoutRights.documentsAvailable, false);
  const withDocs = tickets.find((t) => t.externalId === "2026101200")!;
  assert.deepEqual(withDocs.documents.map((d) => d.name), ["PRIMEIRO ADITIVO - ESCOLA.pdf"]);
  assert.deepEqual(withDocs.groups, ["JURIDICO CONTRATOS"]);
});

test("Falhas do GLPI não expõem tokens e respeitam tempo limite", async () => {
  failInit = true;
  await assert.rejects(new RealGlpiSource(config()).read(new AbortController().signal), (e: any) => {
    assert.match(e.message, /401 ERROR_GLPI_LOGIN_USER_TOKEN/);
    assert.doesNotMatch(e.message, new RegExp(USER));
    return true;
  });
  failInit = false;
  delay = 1500;
  const started = Date.now();
  await assert.rejects(new RealGlpiSource(config()).read(new AbortController().signal), /Tempo limite/);
  assert.ok(Date.now() - started < 6000);
  delay = 0;
  await assert.rejects(
    new RealGlpiSource(config({ GLPI_GROUPS: "JURIDICO INEXISTENTE" })).read(new AbortController().signal),
    /não encontrado ou sem permissão/,
  );
});

test("Chamado de vigência aponta pendências sem inventar datas, numeração ou documentos", () => {
  assert.ok(validCnpj("11.444.777/0001-61"));
  assert.ok(htmlToText(content).includes("RAZÃO SOCIAL: Escola Exemplo Ltda."));
  const analysis = analyzeTicket(
    {
      externalId: "2026101296",
      title: "JURIDICO : SOLICITAÇÃO DE ADITIVO DE CONTRATO PARA ESCOLAS",
      status: "2",
      created: "",
      updated: "",
      category: "",
      groups: ["JURIDICO CONTRATOS"],
      content,
      followups: [],
      documents: [{ id: "1", name: "PRIMEIRO ADITIVO - INCLUSÃO DE ANEXO.pdf", mime: "application/pdf", sha1: "" }],
      documentsAvailable: true,
    },
    { schools: [{ id: "x", cnpj: "11.444.777/0001-61", legal_name: "Escola Exemplo Ltda." }], matrices: [{ id: "m1", school_id: "x" }] },
  );
  assert.equal(analysis.fields.cnpj.value, "11.444.777/0001-61");
  assert.match(analysis.fields.cnpj.origin, /GLPI #2026101296/);
  assert.deepEqual(analysis.suggestion.type + "/" + analysis.suggestion.subtype, "Aditivo/Vigência");
  assert.equal(analysis.schoolId, "x");
  assert.equal(analysis.matrixId, "m1");
  const text = analysis.pendencies.join("\n");
  assert.match(text, /Dia exato da nova vigência não informado/);
  assert.match(text, /Efeito sobre a data final/);
  assert.match(text, /não comprova a sequência assinada/);
  assert.match(text, /Clicksign\/Clint/);
  assert.match(text, /baixe, confira e registre/);
});

test("Sincronização é idempotente, preserva dados locais e registra mudanças externas", async () => {
  let current = content;
  const source = {
    mode: "real" as const,
    read: async () => [
      {
        externalId: "777",
        title: "JURIDICO : SOLICITAÇÃO DE ADITIVO DE CONTRATO PARA ESCOLAS",
        status: "2",
        created: "",
        updated: "",
        category: "",
        groups: ["JURIDICO CONTRATOS"],
        content: current.replace("Escola Exemplo Ltda.", "Colégio Horizonte Educação Ltda.").replace("11.444.777/0001- 61", "10.234.567/0001-90"),
        followups: [],
        documents: [],
        documentsAvailable: true,
      },
    ],
  };
  assert.equal((await syncGlpi("u0", source)).created, 1);
  assert.equal((await syncGlpi("u0", source)).unchanged, 1);
  let tickets = (await request("/glpi/tickets", undefined, admin)).data;
  const ticket = tickets.find((t: any) => t.external_id === "777");
  assert.equal(ticket.analysis.schoolId, "s0");
  assert.equal(ticket.state, "novo");
  // A person confirms school, type, subtype and matrix; nothing is created automatically.
  run("UPDATE contracts SET status='Assinado' WHERE id='c0'");
  run("INSERT OR IGNORE INTO signed_history VALUES('h-glpi','c0',0,'Clicksign','Matriz fictícia conferida','2026-01-01','u0','2026-01-01')");
  const created = await request(
    "/glpi/tickets/777/demand",
    { attested: true, school_id: "s0", type: "Aditivo", subtype: "Vigência", owner: "u2", priority: "Normal", due: "2030-01-01", matrix: "c0" },
    admin,
  );
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const demand = one("SELECT * FROM demands WHERE id=?", created.data.id);
  assert.equal(demand.glpi_id, "777");
  const data = JSON.parse(demand.data);
  assert.match(data.motivo, /Outubro\/2026 para Novembro\/2026/);
  assert.equal(data.inicio, undefined, "nenhuma data é deduzida do chamado");
  assert.equal(
    (await request("/glpi/tickets/777/demand", { attested: true, school_id: "s0", type: "Aditivo", subtype: "Vigência", owner: "u2", priority: "Normal", due: "2030-01-01", matrix: "c0" }, admin)).status,
    400,
  );
  // External change after linking: new immutable version, flag and audit; local data untouched.
  current = content.replace("Novembro/2026", "Dezembro/2026");
  const changed = await syncGlpi("u0", source);
  assert.equal(changed.linkedChanged, 1);
  assert.equal(one("SELECT state FROM glpi_tickets WHERE external_id='777'").state, "alterado após vínculo");
  assert.equal(one("SELECT data FROM demands WHERE id=?", demand.id).data, demand.data);
  assert.equal(all("SELECT * FROM glpi_ticket_versions WHERE external_id='777'").length, 2);
  assert.ok(one("SELECT * FROM audit WHERE demand_id=? AND action LIKE '%mudou após a importação%'", demand.id));
  assert.throws(() => run("DELETE FROM glpi_ticket_versions WHERE external_id='777'"));
  assert.equal((await request("/glpi/tickets/777/acknowledge", { note: "Revisado com o solicitante" }, admin)).status, 200);
  assert.equal(one("SELECT state FROM glpi_tickets WHERE external_id='777'").state, "vinculado");
});

test("Falha de leitura fica registrada no histórico de sincronização", async () => {
  await assert.rejects(syncGlpi("u0", { mode: "real", read: async () => { throw Error("GLPI respondeu 401 ERROR_SESSION_TOKEN_INVALID"); } }));
  const log = one("SELECT * FROM sync_logs ORDER BY created DESC, rowid DESC LIMIT 1");
  assert.equal(log.status, "Falha");
  assert.match(log.message, /ERROR_SESSION_TOKEN_INVALID/);
});

test("Validação cruzada aponta taxa, CNPJ e razão social divergentes do chamado", async () => {
  const { crossCheck } = await import("../server/glpi-analysis.js");
  const ticket = {
    externalId: "900", title: "Solicitação de contrato", status: "2", created: "", updated: "", category: "", groups: [],
    content: "<p>RAZÃO SOCIAL: Escola Exemplo Ltda.</p><p>CNPJ: 11.444.777/0001-61</p><p>TAXA: 7,7%</p>",
    followups: [], documents: [], documentsAvailable: true,
  };
  const analysis = analyzeTicket(ticket, { schools: [], matrices: [] });
  assert.deepEqual(crossCheck(analysis, "900", { cnpj: "11.444.777/0001-61", razaoSocial: "Escola Exemplo Ltda.", remuneracao: "7,70%" }), []);
  const issues = crossCheck(analysis, "900", { cnpj: "11.444.777/0001-62", razaoSocial: "Outra Escola", remuneracao: "7,80%" });
  assert.equal(issues.length, 3);
  assert.match(issues.join("\n"), /Taxa da demanda \(7,80%\) difere da taxa do chamado GLPI #900 \(7,7%\)/);
});
