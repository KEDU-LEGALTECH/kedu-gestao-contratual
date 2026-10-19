/** Read-only GLPI 10 REST client (apirest.php), following the official GLPI 10.0 apirest.md:
 * initSession with App-Token + "Authorization: user_token", Session-Token on every call,
 * killSession at the end, "range" pagination with Content-Range, sub-items via
 * /:itemtype/:id/:sub_itemtype. Only GET is ever issued; no endpoint of plugins is assumed. */
import { createHash } from "node:crypto";

export type GlpiConfig = {
  url: string;
  appToken: string;
  userToken: string;
  groups: string[];
  groupIds: number[];
  actorTypes: number[];
  timeoutMs: number;
  maxTickets: number;
  pageSize: number;
  retries: number;
};
export type RawTicket = {
  externalId: string;
  title: string;
  status: string;
  created: string;
  updated: string;
  category: string;
  groups: string[];
  content: string;
  followups: { id: string; date: string; content: string; private: boolean }[];
  documents: { id: string; name: string; mime: string; sha1: string }[];
  documentsAvailable: boolean;
};
export interface TicketSource {
  mode: "demo" | "real";
  read(signal: AbortSignal): Promise<RawTicket[]>;
}

export function glpiConfig(env = process.env): GlpiConfig {
  const list = (value: string | undefined, fallback: string) =>
    (value ?? fallback)
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
  const numbers = (value: string | undefined, fallback: string) =>
    list(value, fallback)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0);
  const bounded = (value: string | undefined, fallback: number, min: number, max: number) => {
    const n = Number(value ?? fallback);
    return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  return {
    url: (env.GLPI_URL || "").replace(/\/+$/, ""),
    appToken: env.GLPI_APP_TOKEN || "",
    userToken: env.GLPI_USER_TOKEN || "",
    groups: list(env.GLPI_GROUPS, "JURIDICO CONTRATOS;JURIDICO REVISÃO"),
    groupIds: numbers(env.GLPI_GROUP_IDS, ""),
    // CommonITILActor: 1 requester, 2 assigned, 3 observer. Default: tickets assigned to the groups.
    actorTypes: numbers(env.GLPI_ACTOR_TYPES, "2"),
    timeoutMs: bounded(env.GLPI_TIMEOUT_MS, 15000, 1000, 60000),
    maxTickets: bounded(env.GLPI_MAX_TICKETS, 200, 1, 2000),
    pageSize: bounded(env.GLPI_PAGE_SIZE, 50, 5, 200),
    retries: bounded(env.GLPI_RETRIES, 2, 0, 4),
  };
}
export function configProblems(config: GlpiConfig) {
  const problems: string[] = [];
  // HTTPS is mandatory; plain HTTP is accepted only on loopback (local test doubles).
  if (
    !/^https:\/\/[^\s/]+(?:\/[^\s]*)?\/apirest\.php$/.test(config.url) &&
    !/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/[^\s]*)?\/apirest\.php$/.test(config.url)
  )
    problems.push("GLPI_URL deve ser o endereço HTTPS terminado em /apirest.php");
  if (!config.appToken) problems.push("GLPI_APP_TOKEN não configurado no servidor");
  if (!config.userToken) problems.push("GLPI_USER_TOKEN não configurado no servidor");
  if (!config.groups.length && !config.groupIds.length) problems.push("Nenhum grupo autorizado configurado");
  return problems;
}

export class GlpiError extends Error {
  constructor(
    message: string,
    public retriable = false,
  ) {
    super(message);
  }
}
const normalizeName = (s: string) =>
  String(s || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

export class GlpiClient {
  private session = "";
  constructor(
    private config: GlpiConfig,
    private fetchImpl: typeof fetch = fetch,
  ) {}
  private sanitize(text: string) {
    let out = String(text || "");
    for (const secret of [this.config.appToken, this.config.userToken, this.session])
      if (secret) out = out.split(secret).join("[oculto]");
    return out.slice(0, 300);
  }
  async get(path: string, params: Record<string, string> = {}, signal?: AbortSignal) {
    const url = new URL(this.config.url + "/" + path.replace(/^\/+/, ""));
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const headers: Record<string, string> = {
      "App-Token": this.config.appToken,
      Accept: "application/json",
    };
    if (path === "initSession") headers.Authorization = "user_token " + this.config.userToken;
    else headers["Session-Token"] = this.session;
    let last: unknown;
    for (let attempt = 0; attempt <= this.config.retries; attempt++) {
      signal?.throwIfAborted();
      try {
        const timeout = AbortSignal.timeout(this.config.timeoutMs);
        const res = await this.fetchImpl(url, {
          method: "GET",
          headers,
          redirect: "error",
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        const text = await res.text();
        let body: any = null;
        try {
          body = text ? JSON.parse(text) : null;
        } catch {
          throw new GlpiError("Resposta do GLPI não é JSON (" + res.status + ").", res.status >= 500);
        }
        if (res.status === 200 || res.status === 206)
          return { body, range: res.headers.get("Content-Range") || "" };
        const code = Array.isArray(body) ? String(body[0]) : "HTTP_" + res.status;
        if (code === "ERROR_RANGE_EXCEED_TOTAL") return { body: [], range: "" };
        const retriable = res.status >= 500 || res.status === 429;
        throw new GlpiError(
          "GLPI respondeu " + res.status + " " + this.sanitize(code) +
            (Array.isArray(body) && body[1] ? ": " + this.sanitize(body[1]) : ""),
          retriable,
        );
      } catch (error: any) {
        last = error;
        const retriable =
          error instanceof GlpiError ? error.retriable : error?.name === "TimeoutError" || error?.name === "TypeError";
        if (signal?.aborted || !retriable || attempt === this.config.retries) break;
        await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
      }
    }
    if (last instanceof GlpiError) throw last;
    const e: any = last;
    throw new GlpiError(
      e?.name === "TimeoutError" ? "Tempo limite excedido na comunicação com o GLPI." : "Falha de comunicação com o GLPI: " + this.sanitize(e?.message),
    );
  }
  async open(signal?: AbortSignal) {
    const { body } = await this.get("initSession", {}, signal);
    if (!body?.session_token) throw new GlpiError("GLPI não retornou session_token.");
    this.session = String(body.session_token);
  }
  async close() {
    if (!this.session) return;
    try {
      await this.get("killSession");
    } catch {
      /* The session expires on the GLPI side; closing failures never hide the import result. */
    } finally {
      this.session = "";
    }
  }
  /** Reads every page of a list endpoint using range + Content-Range ("0-49/200"). */
  async list(path: string, params: Record<string, string>, max: number, signal?: AbortSignal) {
    const items: any[] = [];
    for (let start = 0; items.length < max; start += this.config.pageSize) {
      const end = Math.min(start + this.config.pageSize, max) - 1;
      const { body, range } = await this.get(path, { ...params, range: `${start}-${end}` }, signal);
      const page = Array.isArray(body) ? body : [];
      items.push(...page);
      const total = Number(/\/(\d+)$/.exec(range)?.[1]);
      if (!page.length || page.length < end - start + 1 || (Number.isFinite(total) && start + page.length >= total)) break;
      if (start > 100_000) throw new GlpiError("Paginação do GLPI não terminou.");
    }
    return items.slice(0, max);
  }
}

export class RealGlpiSource implements TicketSource {
  mode = "real" as const;
  constructor(
    private config: GlpiConfig,
    private fetchImpl: typeof fetch = fetch,
  ) {}
  async read(signal: AbortSignal) {
    const problems = configProblems(this.config);
    if (problems.length) throw new GlpiError("Configuração do GLPI incompleta: " + problems.join("; ") + ".");
    const client = new GlpiClient(this.config, this.fetchImpl);
    await client.open(signal);
    try {
      const groups = await this.groups(client, signal);
      const ids = new Map<string, Set<string>>();
      for (const group of groups) {
        const links = await client.list(`Group/${group.id}/Group_Ticket`, {}, this.config.maxTickets * 4, signal);
        for (const link of links) {
          if (Number(link.groups_id) !== group.id || !this.config.actorTypes.includes(Number(link.type))) continue;
          const id = String(link.tickets_id);
          if (!/^\d+$/.test(id)) continue;
          ids.set(id, (ids.get(id) || new Set()).add(group.name));
        }
      }
      const selected = [...ids.keys()].sort((a, b) => Number(b) - Number(a)).slice(0, this.config.maxTickets);
      const tickets: RawTicket[] = [];
      for (const id of selected) tickets.push(await this.ticket(client, id, [...ids.get(id)!], signal));
      return tickets;
    } finally {
      await client.close();
    }
  }
  private async groups(client: GlpiClient, signal: AbortSignal) {
    const out: { id: number; name: string }[] = [];
    for (const id of this.config.groupIds) {
      const { body } = await client.get(`Group/${id}`, {}, signal);
      out.push({ id, name: String(body?.completename || body?.name || "Grupo " + id) });
    }
    for (const name of this.config.groups) {
      const found = await client.list("Group", { "searchText[name]": name }, 200, signal);
      const exact = found.filter(
        (g) => normalizeName(g.name) === normalizeName(name) || normalizeName(g.completename) === normalizeName(name),
      );
      if (exact.length !== 1)
        throw new GlpiError(
          exact.length
            ? `Mais de um grupo GLPI corresponde a "${name}"; configure GLPI_GROUP_IDS.`
            : `Grupo "${name}" não encontrado ou sem permissão de leitura para o token informado.`,
        );
      if (!out.some((g) => g.id === Number(exact[0].id))) out.push({ id: Number(exact[0].id), name });
    }
    return out;
  }
  private async ticket(client: GlpiClient, id: string, groups: string[], signal: AbortSignal): Promise<RawTicket> {
    const { body: t } = await client.get(`Ticket/${id}`, { expand_dropdowns: "true" }, signal);
    const followups = await client.list(`Ticket/${id}/ITILFollowup`, {}, 200, signal);
    let documents: RawTicket["documents"] = [],
      documentsAvailable = true;
    try {
      const links = await client.list(`Ticket/${id}/Document_Item`, {}, 100, signal);
      for (const link of links) {
        const { body: doc } = await client.get(`Document/${Number(link.documents_id)}`, {}, signal);
        documents.push({
          id: String(link.documents_id),
          name: String(doc?.filename || doc?.name || "documento"),
          mime: String(doc?.mime || ""),
          sha1: String(doc?.sha1sum || ""),
        });
      }
    } catch (error: any) {
      if (signal.aborted) throw error;
      documentsAvailable = false;
      documents = [];
    }
    return {
      externalId: String(t?.id ?? id),
      title: String(t?.name || ""),
      status: String(t?.status ?? ""),
      created: String(t?.date || t?.date_creation || ""),
      updated: String(t?.date_mod || ""),
      category: String(t?.itilcategories_id || ""),
      groups,
      content: String(t?.content || ""),
      followups: followups.map((f) => ({
        id: String(f.id),
        date: String(f.date || f.date_creation || ""),
        content: String(f.content || ""),
        private: Number(f.is_private) === 1,
      })),
      documents,
      documentsAvailable,
    };
  }
}

/** Fictitious tickets for the local demonstration; same shape as the real source. */
export class DemoTicketSource implements TicketSource {
  mode = "demo" as const;
  async read(signal: AbortSignal): Promise<RawTicket[]> {
    signal.throwIfAborted();
    const form = (fields: [string, string][]) =>
      "&lt;div&gt;" + fields.map(([k, v]) => `&lt;p&gt;&lt;b&gt;${k}:&lt;/b&gt; ${v}&lt;/p&gt;`).join("") + "&lt;/div&gt;";
    return [
      {
        externalId: "DEMO-1",
        title: "JURIDICO : SOLICITAÇÃO DE ADITIVO DE CONTRATO PARA ESCOLAS",
        status: "2",
        created: "2026-10-16 10:58:00",
        updated: "2026-10-16 11:02:00",
        category: "MeF advogados > Juridico > CONTRATOS",
        groups: ["JURIDICO CONTRATOS"],
        content: form([
          ["RAZÃO SOCIAL", "Colégio Horizonte Educação Ltda."],
          ["CNPJ", "10.234.567/0001- 90"],
          ["MOTIVO DO ADITIVO", "Alteração de data da vigência de contrato"],
          [
            "OBSERVAÇÕES OU CONSIDERAÇÕES ADICIONAIS",
            "O início de contrato precisa ser alterado de Outubro/2026 para Novembro/2026 (exemplo fictício).",
          ],
          ["ANEXOS", "Documento anexado"],
        ]),
        followups: [],
        documents: [
          { id: "d1", name: "CONTRATO EDUCACIONAIS 2026.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sha1: "" },
          { id: "d2", name: "PRIMEIRO ADITIVO - EXEMPLO.pdf", mime: "application/pdf", sha1: "" },
        ],
        documentsAvailable: true,
      },
      {
        externalId: "DEMO-2",
        title: "JURIDICO : SOLICITAÇÃO DE ADITIVO DE CONTRATO PARA ESCOLAS",
        status: "2",
        created: "2026-10-17 09:00:00",
        updated: "2026-10-17 09:00:00",
        category: "MeF advogados > Juridico > CONTRATOS",
        groups: ["JURIDICO REVISÃO"],
        content: form([
          ["RAZÃO SOCIAL", "Escola Fictícia Não Cadastrada Ltda."],
          ["CNPJ", "11.444.777/0001-61"],
          ["MOTIVO DO ADITIVO", "Alteração de conta bancária"],
          ["OBSERVAÇÕES OU CONSIDERAÇÕES ADICIONAIS", "Nova conta informada no anexo (exemplo fictício)."],
        ]),
        followups: [{ id: "f1", date: "2026-10-17 10:00:00", content: "Anexo enviado em resposta (fictício).", private: false }],
        documents: [],
        documentsAvailable: true,
      },
    ];
  }
}
export const ticketHash = (t: RawTicket) =>
  createHash("sha256")
    .update(JSON.stringify([t.title, t.status, t.content, t.followups, t.documents, t.groups]))
    .digest("hex");
