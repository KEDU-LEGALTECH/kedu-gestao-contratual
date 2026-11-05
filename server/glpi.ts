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
  includePending?: boolean;
  maxPending?: number;
  includeOpen?: boolean;
  maxOpen?: number;
};
export type RawTicket = {
  externalId: string;
  title: string;
  status: string;
  priority?: string;
  created: string;
  updated: string;
  category: string;
  groups: string[];
  content: string;
  followups: { id: string; date: string; content: string; private: boolean }[];
  documents: { id: string; name: string; mime: string; sha1: string }[];
  documentLinks?: Record<string, string[]>;
  messageAuthors?: Record<string, string>;
  documentsAvailable: boolean;
  approvalCoverage?: "not_required" | "complete" | "partial";
  timelineCoverage?: "complete" | "partial";
};
function preserveTimeline(current: RawTicket, previous: RawTicket, approvalsOnly: boolean) {
  const approval = (id: string) => id.startsWith("TicketValidation:");
  const messages = new Map(previous.followups.filter(entry => !approvalsOnly || approval(entry.id)).map(entry => [entry.id, entry]));
  for (const entry of current.followups) messages.set(entry.id, entry);
  const links = { ...current.documentLinks };
  const documents = new Map(current.documents.map(doc => [doc.id, doc]));
  const authors = { ...current.messageAuthors };
  const retained = new Set<string>();
  const nowPrivate = new Set<string>();
  for (const [entry, ids] of Object.entries(previous.documentLinks ?? {})) {
    if (approvalsOnly && !approval(entry)) continue;
    if (messages.get(entry)?.private) {
      ids.forEach(id => nowPrivate.add(id));
      continue;
    }
    links[entry] = [...new Set([...(links[entry] ?? []), ...ids])];
    ids.forEach(id => retained.add(id));
  }
  for (const doc of previous.documents) {
    if (nowPrivate.has(doc.id) && !retained.has(doc.id)) continue;
    if ((!approvalsOnly || retained.has(doc.id)) && (!documents.has(doc.id) || (!documents.get(doc.id)?.mime && !documents.get(doc.id)?.sha1)))
      documents.set(doc.id, doc);
  }
  for (const [entry, author] of Object.entries(previous.messageAuthors ?? {}))
    if ((!approvalsOnly || approval(entry)) && !authors[entry]) authors[entry] = author;
  return { ...current, documents: [...documents.values()], documentLinks: links, messageAuthors: authors,
    followups: [...messages.values()].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)) };
}
export interface TicketSource {
  mode: "demo" | "real";
  read(signal: AbortSignal): Promise<RawTicket[]>;
  failures?: string[];
  reused?: number;
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
    timeoutMs: bounded(env.GLPI_TIMEOUT_MS, 30000, 1000, 60000),
    maxTickets: bounded(env.GLPI_MAX_TICKETS, 200, 1, 2000),
    pageSize: bounded(env.GLPI_PAGE_SIZE, 50, 5, 200),
    retries: bounded(env.GLPI_RETRIES, 2, 0, 4),
    includePending: env.GLPI_INCLUDE_PENDING === "true",
    maxPending: bounded(env.GLPI_MAX_PENDING,200,1,2000),
    includeOpen: env.GLPI_INCLUDE_OPEN === "true",
    maxOpen: bounded(env.GLPI_MAX_OPEN,2000,1,10000),
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
    public status?: number,
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
    // Restrict both the HTTP verb and the resource, even if a future caller passes a new path.
    // Session creation/termination changes only this integration's API session.
    const allowed = /^(?:initSession|killSession|getMyProfiles|getActiveProfile|getMyEntities|getActiveEntities|listSearchOptions\/Ticket|search\/Ticket|Group(?:\/\d+(?:\/Group_Ticket)?)?|Ticket\/\d+(?:\/(?:ITILFollowup|ITILSolution|TicketTask|TicketValidation|Document_Item|Group_Ticket))?|(?:ITILFollowup|ITILSolution|TicketTask|TicketValidation)\/\d+\/Document_Item|Document\/\d+)$/;
    if (!allowed.test(path))
      throw new GlpiError("Recurso bloqueado: a integração GLPI permite apenas as consultas de leitura previstas.");
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
          throw new GlpiError("Resposta do GLPI não é JSON (" + res.status + ").", res.status >= 500, res.status);
        }
        if (res.status === 200 || res.status === 206)
          return { body, range: res.headers.get("Content-Range") || "" };
        const code = Array.isArray(body) ? String(body[0]) : "HTTP_" + res.status;
        if (code === "ERROR_RANGE_EXCEED_TOTAL") return { body: [], range: "" };
        const retriable = res.status >= 500 || res.status === 429;
        throw new GlpiError(
          "GLPI respondeu " + res.status + " " + this.sanitize(code) +
            (Array.isArray(body) && body[1] ? ": " + this.sanitize(body[1]) : ""),
          retriable, res.status,
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
      e?.name === "TimeoutError" ? `Tempo limite de ${this.config.timeoutMs/1000}s excedido na consulta GLPI ${path}.` : "Falha de comunicação com o GLPI na consulta " + path + ": " + this.sanitize(e?.message) + (/^[A-Z0-9_]+$/.test(e?.cause?.code||'')?' ('+e.cause.code+')':''),
    );
  }
  async open(signal?: AbortSignal) {
    const { body } = await this.get("initSession", {}, signal);
    if (!body?.session_token) throw new GlpiError("GLPI não retornou session_token.");
    this.session = String(body.session_token);
  }
  /** Documented GLPI GET /Document/:id?alt=media; credentials stay on the server. */
  async downloadDocument(id: string, signal: AbortSignal, maxBytes = 20 * 1024 * 1024) {
    if (!/^\d+$/.test(id) || !this.session) throw new GlpiError("Documento ou sessão GLPI inválidos.");
    let response: Response;
    try {
      response = await this.fetchImpl(this.config.url + "/Document/" + id + "?alt=media", {
        method: "GET",
        headers: { "App-Token": this.config.appToken, "Session-Token": this.session, Accept: "application/octet-stream" },
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(this.config.timeoutMs)]),
      });
    } catch (error: any) {
      throw new GlpiError("Falha ao baixar documento do GLPI: " + this.sanitize(error?.message));
    }
    if (response.status !== 200 || /json|text\/html/i.test(response.headers.get("content-type") || "")) {
      await response.body?.cancel();
      throw new GlpiError("O GLPI não disponibilizou o arquivo para download (HTTP " + response.status + "). Confira a permissão de leitura dos documentos.");
    }
    if (Number(response.headers.get("content-length")) > maxBytes) {
      await response.body?.cancel();
      throw new GlpiError("Anexo excede o limite de download de 20 MB.");
    }
    if (!response.body) throw new GlpiError("O GLPI retornou um arquivo vazio.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maxBytes) {
          await reader.cancel();
          throw new GlpiError("Anexo excede o limite de download de 20 MB.");
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    if (!size) throw new GlpiError("O GLPI retornou um arquivo vazio.");
    return Buffer.concat(chunks);
  }
  async close() {
    if (!this.session) return;
    try {
      await this.get("killSession", {}, AbortSignal.timeout(2000));
    } catch {
      /* The session expires on the GLPI side; closing failures never hide the import result. */
    } finally {
      this.session = "";
    }
  }
  /** Reads every page of a list endpoint using range + Content-Range ("0-49/200"). */
  async list(path: string, params: Record<string, string>, max: number, signal?: AbortSignal) {
    const items: any[] = [];
    for (let start = 0; items.length < max; ) {
      const end = Math.min(start + this.config.pageSize, max) - 1;
      const { body, range } = await this.get(path, { ...params, range: `${start}-${end}` }, signal);
      if (!Array.isArray(body)) throw new GlpiError("Lista inválida na consulta GLPI " + path + ".");
      const page = body;
      items.push(...page);
      const total = Number(/\/(\d+)$/.exec(range)?.[1]);
      if (!page.length || (Number.isFinite(total) ? start + page.length >= total : page.length < end - start + 1)) break;
      start += page.length;
      if (start > 100_000) throw new GlpiError("Paginação do GLPI não terminou.");
    }
    return items.slice(0, max);
  }
}

const timelineTypes = ["ITILFollowup", "TicketTask", "ITILSolution", "TicketValidation"] as const;

/** Enumerate attachments only through the ticket and its accessible timeline entries. */
export async function readTicketTimeline(client: GlpiClient, ticketId: string, signal: AbortSignal, globalValidation?: unknown) {
  const documentIds = new Set<string>();
  const documentLinks: Record<string, string[]> = {};
  const messageAuthors: Record<string, string> = {};
  const followups: RawTicket["followups"] = [];
  let complete = true;
  const skipApprovals = String(globalValidation) === "1";
  let approvalsPartial = false;
  const list = async (path: string, approval: boolean) => {
    try {
      return await client.list(path, path.endsWith("/Document_Item") ? {} : {expand_dropdowns: "true"}, Infinity, signal);
    } catch (error) {
      if (signal.aborted) throw error;
      if (approval) approvalsPartial = true;
      if (!(approval && error instanceof GlpiError && error.status === 403)) complete = false;
      return [];
    }
  };
  const collect = async (path: string, messageId: string, approval = false) => {
    for (const link of await list(path, approval)) {
      const id = String(link.documents_id);
      if (!/^\d+$/.test(id)) continue;
      documentIds.add(id);
      const linked = documentLinks[messageId] ??= [];
      if (!linked.includes(id)) linked.push(id);
    }
  };
  await collect(`Ticket/${ticketId}/Document_Item`, "initial");
  for (const type of timelineTypes) {
    const approval = type === "TicketValidation";
    if (approval && skipApprovals) continue;
    for (const entry of await list(`Ticket/${ticketId}/${type}`, approval)) {
      const id = String(entry.id);
      if (!/^\d+$/.test(id)) continue;
      const content = String(entry.content || "");
      const messageId = type === "ITILFollowup" ? id : type + ":" + id;
      if (Number(entry.is_private) !== 1) await collect(`${type}/${id}/Document_Item`, messageId, approval);
      const author = typeof entry.users_id === "string" ? entry.users_id.trim() : "";
      if (author && !/^\d+$/.test(author)) messageAuthors[messageId] = author;
      if (content || documentLinks[messageId]?.length) followups.push({
        id: messageId,
        date: String(entry.date || entry.date_creation || ""),
        content,
        private: Number(entry.is_private) === 1,
      });
    }
  }
  followups.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const approvalCoverage: NonNullable<RawTicket["approvalCoverage"]> = skipApprovals ? "not_required" : approvalsPartial ? "partial" : "complete";
  return {documentIds, documentLinks, messageAuthors, followups, complete, approvalCoverage};
}

export class RealGlpiSource implements TicketSource {
  mode = "real" as const;
  failures: string[] = [];
  reused = 0;
  constructor(
    private config: GlpiConfig,
    private fetchImpl: typeof fetch = fetch,
    private previouslyImported: string[] = [],
    private previousTickets: ReadonlyMap<string, RawTicket> = new Map(),
  ) {}
  async readOne(id: string, signal: AbortSignal): Promise<RawTicket> {
    if (!/^\d+$/.test(id)) throw new GlpiError("Número de chamado inválido.");
    const problems = configProblems(this.config);
    if (problems.length) throw new GlpiError(problems.join("; "));
    const client = new GlpiClient(this.config, this.fetchImpl);
    await client.open(signal);
    try {
      const groups = await this.groups(client, signal);
      const actors = await client.list(`Ticket/${id}/Group_Ticket`, {}, Infinity, signal);
      const authorized = groups.filter(group => actors.some(actor =>
        Number(actor.groups_id) === group.id && this.config.actorTypes.includes(Number(actor.type))));
      if (!authorized.length) throw new GlpiError("Chamado fora dos grupos autorizados.");
      return await this.ticket(client, id, authorized.map(group => group.name), signal);
    } finally {
      await client.close();
    }
  }
  async read(signal: AbortSignal) {
    this.failures = [];
    this.reused = 0;
    const problems = configProblems(this.config);
    if (problems.length) throw new GlpiError("Configuração do GLPI incompleta: " + problems.join("; ") + ".");
    const client = new GlpiClient(this.config, this.fetchImpl);
    await client.open(signal);
    try {
      const groups = await this.groups(client, signal);
      const ids = new Map<string, Set<string>>();
      for (const group of groups) {
        for (const id of await this.recentIds(client, group.id, signal)) {
          ids.set(id, (ids.get(id) || new Set()).add(group.name));
        }
      }
      const selected = [...ids.keys()].sort((a, b) => BigInt(a) > BigInt(b) ? -1 : BigInt(a) < BigInt(b) ? 1 : 0).slice(0, this.config.maxTickets);
      // Separate quota: an older pending ticket must not be displaced by recent closed tickets.
      if(this.config.includePending)for(const pending of await this.statusIds(client,groups,signal)){
        ids.set(pending.id,new Set([...(ids.get(pending.id)||[]),...pending.groups]));
        if(!selected.includes(pending.id))selected.push(pending.id);
      }
      if(this.config.includeOpen)for(const status of ["1","2","3"]){
        for(const open of await this.statusIds(client,groups,signal,status)){
          ids.set(open.id,new Set([...(ids.get(open.id)||[]),...open.groups]));
          if(!selected.includes(open.id))selected.push(open.id);
        }
      }
      // Refresh imported tickets outside the recent window, including reopened tickets.
      for(const id of this.previouslyImported)
        if(!selected.includes(id)&&/^\d+$/.test(id))selected.push(id);
      const tickets: RawTicket[] = [];
      let cursor = 0;
      await Promise.all(Array.from({length: Math.min(4, selected.length)}, async () => {
        while (!signal.aborted && cursor < selected.length) {
          const id = selected[cursor++];
          try {
            const ticketSignal = AbortSignal.any([signal, AbortSignal.timeout(90000)]);
            const allowed = ids.get(id) ?? new Set(await this.authorizedGroups(client, groups, id, ticketSignal));
            if (allowed.size) tickets.push(await this.ticket(client, id, [...allowed], ticketSignal, this.previousTickets.get(id)));
          } catch {
            this.failures.push(id);
          }
        }
      }));
      if (signal.aborted) this.failures.push(...selected.slice(cursor));
      if (!tickets.length && this.failures.length) {
        signal.throwIfAborted();
        throw new GlpiError(`Não foi possível atualizar os chamados GLPI (${this.failures.length} falha(s)).`);
      }
      const order = new Map(selected.map((id, i) => [id, i]));
      tickets.sort((a, b) => order.get(a.externalId)! - order.get(b.externalId)!);
      return tickets;
    } finally {
      await client.close();
    }
  }
  private async authorizedGroups(client: GlpiClient, groups: {id:number;name:string}[], id: string, signal: AbortSignal) {
    const links = await client.list(`Ticket/${id}/Group_Ticket`, {}, Infinity, signal);
    return groups.filter(g => links.some(l => Number(l.groups_id) === g.id && String(l.tickets_id) === id &&
      this.config.actorTypes.includes(Number(l.type)))).map(g => g.name);
  }
  private async statusIds(client:GlpiClient,groups:{id:number;name:string}[],signal:AbortSignal,statusValue="4"){
    const {body:options}=await client.get("listSearchOptions/Ticket",{},signal);
    const field=(name:string)=>Object.entries(options||{}).find(([,v]:any)=>v?.table==="glpi_tickets" && v?.field===name)?.[0];
    const status=field("status"),idField=field("id");
    if(!status || !idField)throw new GlpiError("Não foi possível identificar os filtros de status do GLPI.");
    // Discover the assigned-group search option; do not confuse requester,
    // observer or task groups. Membership is still rechecked for every result.
    const assignedGroup=this.config.actorTypes.length===1&&this.config.actorTypes[0]===2?Object.entries(options||{}).find(([,v]:any)=>v?.table==='glpi_groups'&&v?.field==='completename'&&/^(?:GRUPO T[ÉE]CNICO|GRUPO ATRIBU[ÍI]DO|ASSIGNED GROUP|ASSIGNED TO GROUP|GROUPE ATTRIBU[ÉE])$/i.test(String(v.name||'').trim()))?.[0]:undefined;
    const groupCriteria:Record<string,string>={};
    if(assignedGroup)groups.forEach((group,i)=>{
      const prefix=`criteria[1][criteria][${i}]`;
      groupCriteria[prefix+'[field]']=assignedGroup;
      groupCriteria[prefix+'[searchtype]']='equals';
      groupCriteria[prefix+'[value]']=String(group.id);
      if(i)groupCriteria[prefix+'[link]']='OR';
    });
    if(assignedGroup)groupCriteria['criteria[1][link]']='AND';
    const found:{id:string;groups:string[]}[]=[];const seen=new Set<string>();
    for(let start=0;start<10000;){
      const {body}=await client.get("search/Ticket",{"criteria[0][field]":status,"criteria[0][searchtype]":"equals","criteria[0][value]":statusValue,...groupCriteria,"forcedisplay[0]":idField,"forcedisplay[1]":status,sort:idField,order:"DESC",range:`${start}-${start+this.config.pageSize-1}`},signal);
      // GLPI omits `data` entirely when a status has zero results.
      if(body?.totalcount===0 && body?.count===0 && body.data===undefined && start===0)return found;
      if(!Array.isArray(body?.data))throw new GlpiError("Resposta de pesquisa de status inválida.");
      for(const row of body.data){
        const id=String(row[idField]??"");
        if(!/^\d+$/.test(id)||String(row[status])!==statusValue)throw new GlpiError("O GLPI não respeitou o filtro de status dos chamados.");
        if(seen.has(id))throw new GlpiError("Paginação repetida na pesquisa de status.");seen.add(id);
        let allowed: string[];
        try { allowed = await this.authorizedGroups(client, groups, id, signal); }
        catch (error) {
          if (signal.aborted) throw error;
          this.failures.push(id);
          continue;
        }
        if(allowed.length)found.push({id,groups:allowed});
        const limit=statusValue==="4"?(this.config.maxPending||200):(this.config.maxOpen||2000);
        if(found.length>limit)throw new GlpiError(`Limite de chamados do status ${statusValue} atingido. Aumente ${statusValue==="4"?"GLPI_MAX_PENDING":"GLPI_MAX_OPEN"} antes de sincronizar para não omitir chamados.`);
      }
      start+=body.data.length;
      if(!body.data.length || (Number.isFinite(Number(body.totalcount))?start>=Number(body.totalcount):body.data.length<this.config.pageSize))return found;
    }
    throw new GlpiError("Limite de pesquisa de status atingido; sincronização interrompida.");
  }
  /** Ask GLPI to sort by ticket number BEFORE pagination, not by the association's ID.
   * Newest means highest ticket ID, not the date of its last edit or group assignment.
   * N unique tickets per group suffice to obtain the global top N across the groups. */
  private async recentIds(client: GlpiClient, groupId: number, signal: AbortSignal) {
    const selected = new Set<string>();
    const scanLimit = 10000;
    let previous: bigint | null = null;
    for (let start = 0; start < scanLimit;) {
      const end = Math.min(start + this.config.pageSize, scanLimit) - 1;
      const requested = end - start + 1;
      const { body, range } = await client.get(`Group/${groupId}/Group_Ticket`, {
        sort: "tickets_id", order: "DESC", range: `${start}-${end}`,
      }, signal);
      if (!Array.isArray(body)) throw new GlpiError("Lista de vínculos GLPI inválida; seleção dos recentes interrompida.");
      for (const link of body) {
        const id = String(link.tickets_id);
        if (!/^\d+$/.test(id)) throw new GlpiError("Vínculo GLPI sem número de chamado válido.");
        const numericId = BigInt(id);
        if (previous !== null && numericId > previous)
          throw new GlpiError("GLPI não respeitou a ordenação dos chamados recentes; importação interrompida.");
        previous = numericId;
        if (Number(link.groups_id) === groupId && this.config.actorTypes.includes(Number(link.type))) selected.add(id);
      }
      if (selected.size >= this.config.maxTickets) return [...selected].slice(0, this.config.maxTickets);
      const totalMatch = /\/(\d+)$/.exec(range);
      start += body.length;
      if (!body.length || (totalMatch ? start >= Number(totalMatch[1]) : body.length < requested))
        return [...selected];
    }
    throw new GlpiError("Limite de vínculos atingido ao selecionar chamados recentes; revise os filtros antes de importar.");
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
  private async ticket(client: GlpiClient, id: string, groups: string[], signal: AbortSignal, previous?: RawTicket): Promise<RawTicket> {
    const { body: t } = await client.get(`Ticket/${id}`, { expand_dropdowns: "true" }, signal);
    if (!t || String(t.id) !== id) throw new GlpiError("Resposta inválida para o chamado GLPI " + id);
    const updated = String(t.date_mod || "");
    if (previous?.timelineCoverage === "complete" && updated && previous.updated === updated) {
      this.reused++;
      return { ...previous, groups, status: String(t.status ?? ""), priority: String(t.priority ?? "") };
    }
    const timeline = await readTicketTimeline(client, id, signal, t.global_validation);
    const documents: RawTicket["documents"] = [];
    let documentsAvailable = timeline.complete;
    for (const documentId of timeline.documentIds) {
      try {
        const {body: doc} = await client.get(`Document/${documentId}`, {}, signal);
        documents.push({
          id: documentId,
          name: String(doc?.filename || doc?.name || "documento"),
          mime: String(doc?.mime || ""),
          sha1: String(doc?.sha1sum || ""),
        });
      } catch (error) {
        if (signal.aborted) throw error;
        documentsAvailable = false;
        documents.push({id: documentId, name: "Documento " + documentId, mime: "", sha1: ""});
      }
    }
    const suspiciousEmpty = previous?.timelineCoverage !== "complete" && previous?.documentsAvailable === false &&
      previous.documents.length > 0 && !documents.length && !timeline.followups.length;
    const incomplete = !documentsAvailable || suspiciousEmpty;
    const result: RawTicket = {
      externalId: String(t?.id ?? id),
      title: String(t?.name || ""),
      status: String(t?.status ?? ""),
      priority: String(t?.priority ?? ""),
      created: String(t?.date || t?.date_creation || ""),
      updated,
      category: String(t?.itilcategories_id || ""),
      groups,
      content: String(t?.content || ""),
      followups: timeline.followups,
      documentLinks: timeline.documentLinks,
      messageAuthors: timeline.messageAuthors,
      documents,
      documentsAvailable: !incomplete,
      approvalCoverage: timeline.approvalCoverage,
      timelineCoverage: incomplete ? "partial" : "complete",
    };
    return previous && (incomplete || timeline.approvalCoverage === "partial")
      ? preserveTimeline(result, previous, !incomplete) : result;
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
    .update(JSON.stringify([t.title, t.status, t.priority, t.content, t.followups, t.documents, t.groups, ...(t.documentsAvailable ? [] : [false])]))
    .digest("hex");
