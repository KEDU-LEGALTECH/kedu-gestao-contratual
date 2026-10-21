import { one } from "./db.js";
import { GlpiClient, glpiConfig, configProblems, type GlpiConfig } from "./glpi.js";

/** No remote URL supplied by the browser is accepted. Rechecks live group and document links. */
export async function downloadGlpiAttachment(ticketId: string, documentId: string, signal: AbortSignal, config: GlpiConfig = glpiConfig(), fetchImpl: typeof fetch = fetch) {
  if (!/^\d+$/.test(documentId)) throw Error("Identificador de anexo inválido.");
  const ticket = one("SELECT * FROM glpi_tickets WHERE external_id=? AND mode='real'", ticketId);
  if (!ticket) throw Object.assign(Error("Chamado real importado não encontrado."), { status: 404 });
  const payload = JSON.parse(ticket.payload);
  const attachment = payload.documents.find((d: any) => String(d.id) === documentId);
  if (!attachment) throw Object.assign(Error("Anexo não pertence ao chamado selecionado. Sincronize novamente se ele foi adicionado depois."), { status: 404 });
  const problems = configProblems(config);
  if (problems.length) throw Error("Configuração GLPI incompleta: " + problems.join("; "));
  const client = new GlpiClient(config, fetchImpl);
  await client.open(signal);
  try {
    const actors = await client.list(`Ticket/${ticketId}/Group_Ticket`, {}, 1000, signal);
    // Name-only installations resolve the configured group IDs before checking the ticket.
    const allowedIds = new Set(config.groupIds);
    for (const name of config.groups) {
      const groups = await client.list("Group", { "searchText[name]": name }, 200, signal);
      for (const group of groups) if (group.name === name || group.completename === name) allowedIds.add(Number(group.id));
    }
    if (!actors.some(a => allowedIds.has(Number(a.groups_id)) && config.actorTypes.includes(Number(a.type))))
      throw Object.assign(Error("O chamado não está mais atribuído aos grupos autorizados."), { status: 403 });
    const links = await client.list(`Ticket/${ticketId}/Document_Item`, {}, 1000, signal);
    if (!links.some(l => String(l.documents_id) === documentId))
      throw Object.assign(Error("O anexo não está mais vinculado ao chamado. Atualize a sincronização."), { status: 404 });
    const { body: metadata } = await client.get(`Document/${documentId}`, {}, signal);
    const bytes = await client.downloadDocument(documentId, signal);
    const name = String(metadata?.filename || attachment.name || "anexo").replace(/[\r\n\\/]/g, "_").slice(0, 180);
    const mime = /\.docx$/i.test(name)
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : /\.pdf$/i.test(name) ? "application/pdf" : "application/octet-stream";
    return { bytes, name, mime };
  } finally { await client.close(); }
}
