import { conversationText, conversationEntries } from './request-expectations.js';
import { all, one, run, id, now, db, audit, sql, auditAsync } from "./db.js";
import { analyzeTicket } from "./glpi-analysis.js";
import { saveDetails, details, nextReport, matrixCases, subtypes } from "./governance.js";
import { allocateAddendum, invalidate, permit, access } from "./workflow.js";
import { organizations, classifyOrganization } from "./organizations.js";
import { organizationAllowed } from "../shared/organization-policy.js";

export async function receiveGlpiDemands(userId: string | null, ownTransaction = true) {
  return sql.transaction(async () => {
    let created = 0;
    const registry = await organizations();
    for (const ticket of await sql.all("SELECT * FROM glpi_tickets WHERE mode='real' ORDER BY external_id")) {
      const existing = await sql.one("SELECT id FROM demands WHERE glpi_id=?", ticket.external_id);
      if (existing) {
        if (!ticket.demand_id) await sql.run("UPDATE glpi_tickets SET demand_id=?,state='vinculado' WHERE external_id=?", existing.id, ticket.external_id);
        continue;
      }
      if (ticket.demand_id) continue;
      const raw = JSON.parse(ticket.payload);
      const analysis = analyzeTicket(raw, { schools: registry, matrices: [] });
      const data: Record<string, unknown> = { checklist: false };
      const origins: Record<string, string> = {};
      for (const field of ["cnpj", "razaoSocial", "nomeFantasia", "endereco"]) {
        if (analysis.fields[field]) { data[field] = analysis.fields[field].value.slice(0, 500); origins[field] = analysis.fields[field].origin; }
      }
      const narrative = ["motivo", "detalhamento", "observacoes"].map(k => analysis.fields[k]?.value).filter(Boolean).join("\n");
      if (narrative) { data.motivo = narrative.slice(0, 500); origins.motivo = "GLPI #" + ticket.external_id + " — solicitação original (ver conteúdo integral no recebimento)"; }
      const owner = userId && await sql.one("SELECT id FROM users WHERE id=?", userId) ? userId : null;
      const did = "KD-" + id().slice(0, 8).toUpperCase();
      await sql.run("INSERT INTO demands(id,glpi_id,school_id,contract_id,type,stage,priority,owner,due,data,created) VALUES(?,?,?,?,?,?,?,?,?,?,?)", did, ticket.external_id, analysis.organizationId, null, analysis.suggestion.type || "A classificar", "Recebido", "Normal", owner, "", JSON.stringify(data), now());
      await saveDetails(did, { subtype: analysis.suggestion.subtype, reportDate: nextReport(), signers: [], legalFlags: [], origins });
      await sql.run("INSERT INTO glpi_intakes(demand_id,ticket_id,received_hash,received_at) VALUES(?,?,?,?)", did, ticket.external_id, ticket.hash, now());
      await sql.run("UPDATE glpi_tickets SET demand_id=?,state='vinculado' WHERE external_id=?", did, ticket.external_id);
      await auditAsync(did, userId, "Recebido automaticamente do GLPI #" + ticket.external_id + "; sem confirmação, prazo ou contrato reservado");
      created++;
    }
    return { created };
  });
}

export async function intakeForDemand(demandId: string) {
  const intake = await sql.one("SELECT i.*,t.payload,t.hash AS current_hash FROM glpi_intakes i JOIN glpi_tickets t ON t.external_id=i.ticket_id WHERE i.demand_id=?", demandId);
  if (!intake) return null;
  const raw = JSON.parse(intake.payload);
  return { ...intake, payload: undefined, title: raw.title, text: conversationText(raw), conversation: conversationEntries(raw), documentsAvailable: raw.documentsAvailable, approvalCoverage: raw.approvalCoverage, documents: raw.documents,
    analysis: analyzeTicket(raw, { schools: await organizations(), matrices: await sql.all("SELECT id,school_id FROM contract_registry WHERE instrument_kind='Matriz' AND status='Assinado'") }) };
}

export async function confirmGlpiIntake(user: any, demand: any, body: any) {
  permit(user, "write"); permit(user, "confirm"); access(user, demand);
  await sql.transaction(async () => {
    const current = await sql.one("SELECT * FROM demands WHERE id=?", demand.id);
    const intake = await intakeForDemand(current.id);
    if (!intake || intake.confirmed_at || !["Recebido","Aguardando informações","Devolvido"].includes(current.stage)) throw Error("Recebimento não está disponível para confirmação.");
    if (body.expected_version !== current.data_version || body.expected_hash !== intake.current_hash)
      throw Object.assign(Error("O chamado ou a demanda mudou. Reabra antes de confirmar."), { status: 409 });
    const school = await sql.one("SELECT * FROM schools WHERE id=?", body.school_id);
    if (!school) throw Error("Selecione ou cadastre a organização com os dados conferidos.");
    const classification = await sql.one("SELECT * FROM organization_classifications WHERE school_id=?", school.id);
    let kind = classification?.kind || "Escola";
    if (kind === "Aguardando classificação") {
      permit(user, "schools");
      if (!body.organization_kind) throw Error("Confirme a categoria da organização.");
      await classifyOrganization(school.id, body.organization_kind, classification.version, body.note, user.id, false);
      kind = body.organization_kind;
    }
    if (!organizationAllowed(body.type, kind)) throw Error("Categoria incompatível com o tipo de demanda.");
    if (!await sql.one("SELECT id FROM users WHERE id=? AND role IN('Administrador','Operação','Risco','Solicitante')", body.owner)) throw Error("Responsável inválido.");
    const data = JSON.parse(current.data);
    if (data.cnpj && data.cnpj.replace(/\D/g, "") !== school.cnpj.replace(/\D/g, "")) throw Error("CNPJ da organização difere do chamado; confira a origem antes de vincular.");
    let contractId: string;
    if (body.matrix && !await sql.one("SELECT id FROM contract_registry WHERE id=? AND school_id=? AND instrument_kind='Matriz'", body.matrix, school.id)) throw Error("Matriz inválida para a organização selecionada.");
    if (body.type === "Aditivo") {
      if (!subtypes.includes(body.subtype)) throw Error("Selecione o subtipo do aditivo.");
      const allocated = await allocateAddendum(school.id, body.matrix || "", false);
      contractId = allocated.id; data.aditivo = String(allocated.sequence); data.matriz = body.matrix;
    } else {
      if (matrixCases.includes(body.type) && !await sql.one("SELECT id FROM contract_registry WHERE id=? AND school_id=? AND instrument_kind='Matriz' AND (status='Assinado' OR (?='Migração de modalidade' AND status='Distratado'))", body.matrix || "", school.id, body.type)) throw Error("Selecione a matriz assinada da organização para esta operação.");
      contractId = id();
      await sql.run("INSERT INTO contracts(id,school_id) VALUES(?,?)", contractId, school.id);
      data.matriz = body.matrix || contractId; data.aditivo = "Não aplicável";
    }
    Object.assign(data, { cnpj: school.cnpj, razaoSocial: school.legal_name, endereco: school.address || data.endereco || "" });
    await sql.run("UPDATE demands SET school_id=?,contract_id=?,type=?,owner=?,priority=?,due=?,data=?,data_version=data_version+1,confirmed=0 WHERE id=?", school.id, contractId, body.type, body.owner, body.priority, body.due, JSON.stringify(data), current.id);
    await saveDetails(current.id, { ...await details(current), subtype: body.type === "Aditivo" ? body.subtype : "", origins: { ...(await details(current)).origins, cnpj: "Cadastro confrontado com GLPI #" + current.glpi_id, razaoSocial: "Cadastro confirmado no recebimento GLPI" } });
    await sql.run("UPDATE glpi_intakes SET confirmed_at=?,confirmed_by=?,received_hash=?,note=? WHERE demand_id=?", now(), user.id, intake.current_hash, body.note, current.id);
    await invalidate(current.id);
    await auditAsync(current.id, user.id, "Recebimento GLPI conferido: " + body.note);
  });
}
