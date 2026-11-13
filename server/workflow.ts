import { basisPoints, cents } from "./decimal.js";
import { one, all, run, id, now, db, audit, sql, auditAsync } from "./db.js";
import { governanceMissing, requirements, humanMissing } from "./governance.js";
import { requiredFor } from "../shared/request-policy.js";
import { assertProductionTemplate } from "./template-policy.js";
import { access, permit } from "../shared/access-policy.js";
export const stages = [
  "Recebido",
  "Aguardando informações",
  "Em elaboração",
  "Em conferência",
  "Em aprovação",
  "Em assinatura",
  "Concluído",
  "Devolvido",
  "Cancelado",
];
export { permissions, permit, access } from "../shared/access-policy.js";
export async function required(d: any) {
  const data = JSON.parse(d.data);
  return requiredFor(d.type, (await requirements(d)).subtype, data.modalidade || "")
    .filter((f) => typeof data[f] !== "string" || !data[f].trim())
    .concat(
      data.checklist ? [] : ["Documentação obrigatória"],
      await governanceMissing(d),
    );
}
export async function latest(d: string) {
  return await sql.one("SELECT * FROM documents WHERE demand_id=? ORDER BY version DESC LIMIT 1", d);
}
export async function invalidate(d: string) {
  await sql.run("UPDATE approvals SET valid=0 WHERE document_id IN (SELECT id FROM documents WHERE demand_id=?)", d);
}
export async function saveTerms(demandId: string, data: any) {
  if (data.cashbackValor)
    await sql.run("INSERT INTO cashback_values VALUES(?,?) ON CONFLICT(demand_id) DO UPDATE SET amount_cents=excluded.amount_cents", demandId, cents(data.cashbackValor));
  else await sql.run("DELETE FROM cashback_values WHERE demand_id=?", demandId);
  if (!["remuneracao", "garantia", "repasse", "valor"].every((k) => data[k]))
    return;
  await sql.run("INSERT INTO commercial_terms VALUES(?,?,?,?,?,?) ON CONFLICT(demand_id) DO UPDATE SET remuneration_bps=excluded.remuneration_bps,guarantee_bps=excluded.guarantee_bps,transfer_bps=excluded.transfer_bps,cashback_bps=excluded.cashback_bps,reference_cents=excluded.reference_cents", demandId, basisPoints(data.remuneracao), basisPoints(data.garantia), basisPoints(data.repasse), basisPoints(data.cashback || "0,00%"), cents(data.valor));
}
export async function allocateAddendum(
  school: string,
  parent: string,
  ownTransaction = true,
) {
  return await sql.transaction(async () => {
    const matrix = await sql.one("SELECT * FROM contract_registry WHERE id=? AND school_id=? AND status=? AND instrument_kind='Matriz'", parent, school, "Assinado");
    if (!matrix || matrix.parent_id)
      throw Error("Aditivo exige contrato matriz assinado da mesma escola.");
    const history = await sql.one("SELECT * FROM signed_history WHERE matrix_id=? ORDER BY sequence DESC LIMIT 1", parent);
    if (!history)
      throw Error(
        "Confirme o último aditivo assinado no Clicksign/Clint antes de reservar a numeração.",
      );
    if (
      history.source === "Registro local" &&
      !await sql.one("SELECT id FROM history_confirmations WHERE matrix_id=? AND sequence=?", parent, history.sequence)
    )
      throw Error(
        "Consulte Clicksign/Clint e confirme o novo último assinado antes da próxima emissão.",
      );
    const seq = history.sequence + 1;
    if (
      await sql.one("SELECT id FROM contracts WHERE parent_id=? AND sequence=?", parent, seq)
    )
      throw Error(
        "O próximo número já está reservado. Conclua a reserva ou reconcilie o histórico assinado; números cancelados não são reutilizados automaticamente.",
      );
    /* Signed history is immutable and the unique index serializes reservations. */
    const cid = id();
    await sql.run("INSERT INTO contracts(id,school_id,parent_id,sequence) VALUES(?,?,?,?)", cid, school, parent, seq);
    return { id: cid, sequence: seq };
  });
}
export async function transition(user: any, d: any, stage: string, reason?: string) {
  await sql.transaction(async () => {
    await applyTransition(user, d, stage, reason);
  });
}
async function applyTransition(user: any, d: any, stage: string, reason?: string) {
  permit(user, "write");
  access(user, d);
  if (["Concluído", "Cancelado"].includes(d.stage))
    throw Error(
      "Demandas concluídas ou canceladas têm histórico encerrado. Crie uma nova demanda.",
    );
  if (!stages.includes(stage)) throw Error("Etapa inválida.");
  if (!["Cancelado", "Devolvido", "Aguardando informações"].includes(stage) && await sql.one("SELECT demand_id FROM glpi_intakes WHERE demand_id=? AND confirmed_at IS NULL", d.id))
    throw Error("Confira o recebimento GLPI antes de avançar a demanda.");
  if (["Cancelado", "Devolvido"].includes(stage)) {
    if (!reason?.trim()) throw Error("Informe uma justificativa.");
    await invalidate(d.id);
  } else {
    const edges: Record<string, string[]> = {
      Recebido: ["Aguardando informações", "Em elaboração"],
      "Aguardando informações": ["Em elaboração"],
      "Em elaboração": ["Em conferência"],
      "Em conferência": ["Em elaboração", "Em aprovação"],
      "Em aprovação": ["Em elaboração", "Em assinatura"],
      "Em assinatura": ["Concluído"],
      Devolvido: ["Em elaboração"],
    };
    if (!edges[d.stage]?.includes(stage))
      throw Error("Transição não permitida.");
    const doc = await latest(d.id);
    if (
      doc &&
      ["Em conferência", "Em aprovação", "Em assinatura", "Concluído"].includes(
        stage,
      )
    )
      assertProductionTemplate(
        await sql.one("SELECT demonstration FROM template_catalog WHERE version_id=?", doc.template_version),
      );
    if (["Em conferência", "Em aprovação", "Em assinatura"].includes(stage)) {
      if ((await required(d)).length || !d.confirmed)
        throw Error(
          "Confirme os dados e complete todos os campos e documentos obrigatórios.",
        );
      if (!doc || doc.data_version !== d.data_version)
        throw Error("Gere uma minuta com a versão atual dos dados.");
    }
    if (["Em aprovação", "Em assinatura"].includes(stage)) {
      const r = await sql.one("SELECT * FROM reviews WHERE document_id=? ORDER BY created DESC LIMIT 1", doc.id);
      if (r?.status !== "conforme")
        throw Error("Conferência inconclusiva ou divergente impede o avanço.");
    }
    if (stage === "Em assinatura") {
      const approvals = await sql.all("SELECT kind FROM approvals WHERE document_id=? AND data_version=? AND valid=1", doc.id, d.data_version);
      if (
        !(await requirements(d)).approvals.every((k) =>
          approvals.some((a) => a.kind === k),
        )
      )
        throw Error(
          "Validações obrigatórias: " + (await requirements(d)).approvals.join(", "),
        );
      if ((await humanMissing(doc)).length)
        throw Error(
          "Complete os cinco eixos de revisão humana antes da assinatura.",
        );
    }
    if (stage === "Concluído") {
      if (!doc?.signed)
        throw Error("Anexe o documento assinado antes de concluir.");
      const terms = JSON.parse(d.data);
      const contract = await sql.one("SELECT * FROM contract_registry WHERE id=?", d.contract_id);
      if (contract?.instrument_kind === "Aditivo")
        await sql.run("INSERT INTO signed_history VALUES(?,?,?,?,?,?,?,?)", id(), contract.parent_id, contract.sequence, "Registro local", "Documento " + doc.id, terms.dataFormalizacao, user.id, now());
      await sql.run("UPDATE contracts SET status=?,start=?,\"end\"=? WHERE id=?", contract?.instrument_kind === "Operação jurídica"
          ? "Concluído"
          : "Assinado", terms.inicio || null, terms.fim || null, d.contract_id);
      const sourceStatus: Record<string, string> = {
        Distrato: "Distratado",
        Descredenciamento: "Descredenciado",
        "Migração de modalidade": "Migrado",
      };
      if (sourceStatus[d.type]) {
        if (d.type === "Migração de modalidade" && (await required(d)).length)
          throw Error(
            "Conclua os requisitos e as demandas vinculadas antes de encerrar a migração.",
          );
        const matrix = await sql.one("SELECT * FROM contract_registry WHERE id=? AND school_id=? AND instrument_kind='Matriz'", terms.matriz || "", d.school_id);
        if (!matrix || matrix.id === d.contract_id)
          throw Error("Matriz de origem inválida para concluir a operação.");
        if (!(
          matrix.status === "Assinado" ||
          (d.type === "Migração de modalidade" &&
            matrix.status === "Distratado")
        ))
          throw Error(
            "A matriz de origem já foi encerrada por outra operação. Revise o vínculo antes de concluir.",
          );
        await sql.run("UPDATE contracts SET status=? WHERE id=?", sourceStatus[d.type], matrix.id);
        await auditAsync(d.id, user.id, `Matriz ${matrix.id}: ${sourceStatus[d.type]}`);
      }
    }
  }
  await sql.run("UPDATE demands SET stage=?,completed=? WHERE id=?", stage, stage === "Concluído" ? now() : null, d.id);
  await auditAsync(d.id, user.id, `Etapa: ${stage}${reason ? " • " + reason : ""}`);
}
