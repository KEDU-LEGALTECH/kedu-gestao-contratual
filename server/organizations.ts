import { all, one, run, db, audit, now } from "./db.js";
import { organizationAllowed } from "../shared/organization-policy.js";
export function organizations(owner?: string) {
  return all(`SELECT s.*,o.first_ticket AS glpi_ticket,o.imported_at AS glpi_imported_at,o.reviewed_at AS glpi_reviewed_at,
    COALESCE(c.kind,CASE WHEN o.school_id IS NOT NULL THEN 'Aguardando classificação' ELSE 'Escola' END) AS organization_kind,COALESCE(c.version,0) AS classification_version,c.note AS classification_note
    FROM schools s LEFT JOIN school_glpi_origins o ON o.school_id=s.id LEFT JOIN organization_classifications c ON c.school_id=s.id
    ${owner ? "WHERE EXISTS(SELECT 1 FROM demands d WHERE d.school_id=s.id AND d.owner=?)" : ""} ORDER BY s.name`, ...(owner ? [owner] : []));
}
export function classifyOrganization(schoolId: string, kind: string, version: number, note: string, userId: string, ownTransaction = true) {
  if (ownTransaction) db.exec("BEGIN IMMEDIATE");
  try {
    const current = one("SELECT * FROM organization_classifications WHERE school_id=?", schoolId);
    if (!current) throw Error("Organização importada não encontrada.");
    if (current.version !== version) throw Object.assign(Error("Classificação alterada por outra pessoa. Atualize a página."), { status: 409 });
    if (all("SELECT type FROM demands WHERE school_id=? AND NOT EXISTS(SELECT 1 FROM glpi_intakes i WHERE i.demand_id=demands.id AND i.confirmed_at IS NULL)", schoolId).some(d => !organizationAllowed(d.type, kind)) ||
        (kind !== "Escola" && one("SELECT id FROM contracts WHERE school_id=? AND NOT EXISTS(SELECT 1 FROM demands d WHERE d.contract_id=contracts.id AND d.type IN('Contrato fornecedor','Contrato marketing'))", schoolId)))
      throw Error("Há vínculos de escola incompatíveis com essa categoria. Confira as demandas e contratos antes de reclassificar.");
    run("UPDATE organization_classifications SET kind=?,version=version+1,classified_by=?,classified_at=?,note=? WHERE school_id=? AND version=?", kind, userId, now(), note, schoolId, version);
    audit(null, userId, `Organização ${schoolId}: ${current.kind} → ${kind}. ${note}`);
    if (ownTransaction) db.exec("COMMIT");
  } catch (error) { if (ownTransaction) db.exec("ROLLBACK"); throw error; }
}
