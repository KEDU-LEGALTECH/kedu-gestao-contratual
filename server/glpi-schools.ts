import { all, one, run, id, now, db, audit } from "./db.js";
import { analyzeTicket, cnpjDigits, validCnpj, formatCnpj } from "./glpi-analysis.js";

const comparable = (name: string) => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
/** Build the local registry from real tickets already read within the authorised groups.
 * No GLPI requests, invented addresses or changes to existing school data. */
export function importGlpiSchools(userId: string | null, ownTransaction = true) {
  const summary = { created: 0, matched: 0, skipped: 0, conflicts: 0 };
  if (ownTransaction) db.exec("BEGIN IMMEDIATE");
  try {
    const seen = new Set<string>();
    for (const ticket of all("SELECT external_id,hash,payload FROM glpi_tickets WHERE mode='real' ORDER BY external_id DESC")) {
      const analysis = analyzeTicket(JSON.parse(ticket.payload), { schools: [], matrices: [] });
      const cnpj = cnpjDigits(analysis.fields.cnpj?.value || "");
      const name = analysis.fields.razaoSocial?.value.trim() || "";
      if (!validCnpj(cnpj) || name.length < 3 || name.length > 250 || /^(?:\[.*\]|não informad[oa]|n[aã]o se aplica|pendente)$/i.test(name)) {
        summary.skipped++;
        continue;
      }
      let school = one("SELECT * FROM schools WHERE replace(replace(replace(replace(cnpj,'.',''),'/',''),'-',''),' ','')=?", cnpj);
      if (!school) {
        school = { id: id(), legal_name: name };
        run("INSERT INTO schools(id,name,legal_name,cnpj,address,contact) VALUES(?,?,?,?,?,?)", school.id, name, name, formatCnpj(cnpj), "", "");
        run("INSERT INTO school_glpi_origins(school_id,first_ticket,imported_at) VALUES(?,?,?)", school.id, ticket.external_id, now());
        run("INSERT INTO organization_classifications(school_id,kind) VALUES(?,'Aguardando classificação')", school.id);
        audit(null, userId, `Organização importada do GLPI #${ticket.external_id}; aguardando classificação: ${school.id}`);
        summary.created++;
      } else if (!seen.has(cnpj)) summary.matched++;
      seen.add(cnpj);
      const conflict = comparable(school.legal_name) !== comparable(name);
      if (conflict) summary.conflicts++;
      run("INSERT OR IGNORE INTO school_glpi_sources VALUES(?,?,?,?,?,?,?)", school.id, ticket.external_id, ticket.hash, name, formatCnpj(cnpj), conflict ? 1 : 0, now());
    }
    if (ownTransaction) db.exec("COMMIT");
    return summary;
  } catch (error) {
    if (ownTransaction) db.exec("ROLLBACK");
    throw error;
  }
}
