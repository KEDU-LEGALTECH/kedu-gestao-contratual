import { all, one, run, id, now, db, audit, sql, auditAsync } from "./db.js";
import { analyzeTicket, cnpjDigits, htmlToText, extractFields } from "./glpi-analysis.js";
import { formatDocument, validDocument } from "./reference-document.js";
import { documentIdentifier } from "./organization-evidence.js";

const comparable = (name: string) => name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const findOrganization = (digits: string) =>
  sql.one("SELECT * FROM schools WHERE replace(replace(replace(replace(cnpj,'.',''),'/',''),'-',''),' ','')=?", digits);
/** The ticket's organization identifier: the form value when it is verifiable, otherwise the single
 * matching identifier printed in the documents already read for the demand. */
export async function ticketOrganization(ticket: { external_id: string; hash: string; payload: string; demand_id?: string | null }) {
  const raw = JSON.parse(ticket.payload);
  const analysis = analyzeTicket(raw, { schools: [], matrices: [] });
  const typed = cnpjDigits(analysis.fields.cnpj?.value || "");
  const name = analysis.fields.razaoSocial?.value.trim() || "";
  if (validDocument(typed)) return { digits: typed, name, source: `GLPI #${ticket.external_id}`, single: true };
  if (!ticket.demand_id) return null;
  const formDigits = cnpjDigits(extractFields(htmlToText(raw.content)).cnpj || "");
  const found = await documentIdentifier(ticket.demand_id, ticket.hash, analysis.organizationCandidates, formDigits);
  return found && { ...found, name: found.name || (analysis.organizationCandidates.length ? "" : name), source: `GLPI #${ticket.external_id} e ${found.source}`, single: false };
}
/** Build the local registry from real tickets already read within the authorised groups.
 * No GLPI requests, invented addresses or changes to existing school data. */
export async function importGlpiSchools(userId: string | null, ownTransaction = true) {
  const summary = { created: 0, matched: 0, skipped: 0, conflicts: 0 };
  return await sql.transaction(async () => {
    const seen = new Set<string>();
    for (const ticket of await sql.all("SELECT external_id,hash,payload,demand_id FROM glpi_tickets WHERE mode='real' ORDER BY external_id DESC")) {
      const organization = await ticketOrganization(ticket);
      let school = organization && await findOrganization(organization.digits);
      const name = organization?.name || school?.legal_name || "";
      if (!organization || name.length < 3 || name.length > 250 || /^(?:\[.*\]|não informad[oa]|n[aã]o se aplica|pendente)$/i.test(name)) {
        summary.skipped++;
        continue;
      }
      const cnpj = organization.digits;
      if (!school) {
        school = { id: id(), legal_name: name };
        await sql.run("INSERT INTO schools(id,name,legal_name,cnpj,address,contact) VALUES(?,?,?,?,?,?)", school.id, name, name, formatDocument(cnpj), "", "");
        await sql.run("INSERT INTO school_glpi_origins(school_id,first_ticket,imported_at) VALUES(?,?,?)", school.id, ticket.external_id, now());
        await sql.run("INSERT INTO organization_classifications(school_id,kind) VALUES(?,'Aguardando classificação')", school.id);
        await auditAsync(null, userId, `Organização importada de ${organization.source}; aguardando classificação: ${school.id}`);
        summary.created++;
      } else if (!seen.has(cnpj)) summary.matched++;
      seen.add(cnpj);
      const conflict = comparable(school.legal_name) !== comparable(name);
      if (conflict) summary.conflicts++;
      await sql.run("INSERT OR IGNORE INTO school_glpi_sources VALUES(?,?,?,?,?,?,?)", school.id, ticket.external_id, ticket.hash, name, formatDocument(cnpj), conflict ? 1 : 0, now());
    }
    return summary;
  });
}
/** Demands received before their organization could be identified are linked once it can be, while
 * nobody has confirmed the receipt yet. The person still confirms the organization in the receipt. */
export async function linkPendingOrganizations(userId: string | null) {
  let linked = 0;
  for (const ticket of await sql.all(`SELECT t.external_id,t.hash,t.payload,t.demand_id FROM glpi_tickets t JOIN demands d ON d.id=t.demand_id
    WHERE t.mode='real' AND (d.school_id IS NULL OR d.school_id='') AND d.confirmed=0`)) {
    const organization = await ticketOrganization(ticket);
    const school = organization && await findOrganization(organization.digits);
    if (!school) continue;
    await sql.run("UPDATE demands SET school_id=? WHERE id=? AND (school_id IS NULL OR school_id='') AND confirmed=0", school.id, ticket.demand_id);
    await auditAsync(ticket.demand_id, userId, `Organização vinculada automaticamente (${formatDocument(organization.digits)}, a partir de ${organization.source}); confirme no recebimento`);
    linked++;
  }
  return linked;
}
