import { basisPoints, cents } from "./decimal.js";
import { one, all, run, id, now, db, audit } from "./db.js";
import { governanceMissing, requirements, humanMissing } from "./governance.js";
import { requiredFor } from "../shared/request-policy.js";
import { assertProductionTemplate } from "./template-policy.js";
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
export const permissions: Record<string, string[]> = {
  Administrador: [
    "write",
    "schools",
    "confirm",
    "review",
    "commercial",
    "legal",
    "bank",
    "files",
    "sync",
    "settings",
    "export",
    "risk",
    "finance",
  ],
  Solicitante: ["write"],
  Operação: [
    "write",
    "schools",
    "confirm",
    "review",
    "bank",
    "files",
    "export",
  ],
  Jurídico: ["review", "legal", "bank", "files", "export"],
  Aprovador: ["commercial", "bank", "files", "export"],
  Consulta: [],
  Risco: [
    "write",
    "schools",
    "confirm",
    "review",
    "risk",
    "bank",
    "files",
    "export",
  ],
  Financeiro: ["finance", "bank", "files", "export", "review"],
};
export function permit(user: any, action: string) {
  if (!permissions[user.role]?.includes(action))
    throw Object.assign(Error("Seu perfil não tem permissão para esta ação."), {
      status: 403,
    });
}
export function access(user: any, demand: any) {
  if (user.role === "Solicitante" && demand.owner !== user.id)
    throw Object.assign(Error("Registro restrito ao responsável."), {
      status: 403,
    });
}
export function required(d: any) {
  const data = JSON.parse(d.data);
  return requiredFor(d.type, requirements(d).subtype, data.modalidade || "")
    .filter((f) => typeof data[f] !== "string" || !data[f].trim())
    .concat(
      data.checklist ? [] : ["Documentação obrigatória"],
      governanceMissing(d),
    );
}
export function latest(d: string) {
  return one(
    "SELECT * FROM documents WHERE demand_id=? ORDER BY version DESC LIMIT 1",
    d,
  );
}
export function invalidate(d: string) {
  run(
    "UPDATE approvals SET valid=0 WHERE document_id IN (SELECT id FROM documents WHERE demand_id=?)",
    d,
  );
}
export function saveTerms(demandId: string, data: any) {
  if (data.cashbackValor)
    run(
      "INSERT INTO cashback_values VALUES(?,?) ON CONFLICT(demand_id) DO UPDATE SET amount_cents=excluded.amount_cents",
      demandId,
      cents(data.cashbackValor),
    );
  else run("DELETE FROM cashback_values WHERE demand_id=?", demandId);
  if (!["remuneracao", "garantia", "repasse", "valor"].every((k) => data[k]))
    return;
  run(
    "INSERT INTO commercial_terms VALUES(?,?,?,?,?,?) ON CONFLICT(demand_id) DO UPDATE SET remuneration_bps=excluded.remuneration_bps,guarantee_bps=excluded.guarantee_bps,transfer_bps=excluded.transfer_bps,cashback_bps=excluded.cashback_bps,reference_cents=excluded.reference_cents",
    demandId,
    basisPoints(data.remuneracao),
    basisPoints(data.garantia),
    basisPoints(data.repasse),
    basisPoints(data.cashback || "0,00%"),
    cents(data.valor),
  );
}
export function allocateAddendum(
  school: string,
  parent: string,
  ownTransaction = true,
) {
  if (ownTransaction) db.exec("BEGIN IMMEDIATE");
  try {
    const matrix = one(
      "SELECT * FROM contract_registry WHERE id=? AND school_id=? AND status=? AND instrument_kind='Matriz'",
      parent,
      school,
      "Assinado",
    );
    if (!matrix || matrix.parent_id)
      throw Error("Aditivo exige contrato matriz assinado da mesma escola.");
    const history = one(
      "SELECT * FROM signed_history WHERE matrix_id=? ORDER BY sequence DESC LIMIT 1",
      parent,
    );
    if (!history)
      throw Error(
        "Confirme o último aditivo assinado no Clicksign/Clint antes de reservar a numeração.",
      );
    if (
      history.source === "Registro local" &&
      !one(
        "SELECT id FROM history_confirmations WHERE matrix_id=? AND sequence=?",
        parent,
        history.sequence,
      )
    )
      throw Error(
        "Consulte Clicksign/Clint e confirme o novo último assinado antes da próxima emissão.",
      );
    const seq = history.sequence + 1;
    if (
      one(
        "SELECT id FROM contracts WHERE parent_id=? AND sequence=?",
        parent,
        seq,
      )
    )
      throw Error(
        "O próximo número já está reservado. Conclua a reserva ou reconcilie o histórico assinado; números cancelados não são reutilizados automaticamente.",
      );
    /* Signed history is immutable and the unique index serializes reservations. */
    const cid = id();
    run(
      "INSERT INTO contracts(id,school_id,parent_id,sequence) VALUES(?,?,?,?)",
      cid,
      school,
      parent,
      seq,
    );
    if (ownTransaction) db.exec("COMMIT");
    return { id: cid, sequence: seq };
  } catch (e) {
    if (ownTransaction) db.exec("ROLLBACK");
    throw e;
  }
}
export function transition(user: any, d: any, stage: string, reason?: string) {
  db.exec("BEGIN IMMEDIATE");
  try {
    applyTransition(user, d, stage, reason);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
function applyTransition(user: any, d: any, stage: string, reason?: string) {
  permit(user, "write");
  access(user, d);
  if (["Concluído", "Cancelado"].includes(d.stage))
    throw Error(
      "Demandas concluídas ou canceladas têm histórico encerrado. Crie uma nova demanda.",
    );
  if (!stages.includes(stage)) throw Error("Etapa inválida.");
  if (!["Cancelado", "Devolvido", "Aguardando informações"].includes(stage) && one("SELECT demand_id FROM glpi_intakes WHERE demand_id=? AND confirmed_at IS NULL", d.id))
    throw Error("Confira o recebimento GLPI antes de avançar a demanda.");
  if (["Cancelado", "Devolvido"].includes(stage)) {
    if (!reason?.trim()) throw Error("Informe uma justificativa.");
    invalidate(d.id);
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
    const doc = latest(d.id);
    if (
      doc &&
      ["Em conferência", "Em aprovação", "Em assinatura", "Concluído"].includes(
        stage,
      )
    )
      assertProductionTemplate(
        one(
          "SELECT demonstration FROM template_catalog WHERE version_id=?",
          doc.template_version,
        ),
      );
    if (["Em conferência", "Em aprovação", "Em assinatura"].includes(stage)) {
      if (required(d).length || !d.confirmed)
        throw Error(
          "Confirme os dados e complete todos os campos e documentos obrigatórios.",
        );
      if (!doc || doc.data_version !== d.data_version)
        throw Error("Gere uma minuta com a versão atual dos dados.");
    }
    if (["Em aprovação", "Em assinatura"].includes(stage)) {
      const r = one(
        "SELECT * FROM reviews WHERE document_id=? ORDER BY created DESC LIMIT 1",
        doc.id,
      );
      if (r?.status !== "conforme")
        throw Error("Conferência inconclusiva ou divergente impede o avanço.");
    }
    if (stage === "Em assinatura") {
      const approvals = all(
        "SELECT kind FROM approvals WHERE document_id=? AND data_version=? AND valid=1",
        doc.id,
        d.data_version,
      );
      if (
        !requirements(d).approvals.every((k) =>
          approvals.some((a) => a.kind === k),
        )
      )
        throw Error(
          "Validações obrigatórias: " + requirements(d).approvals.join(", "),
        );
      if (humanMissing(doc).length)
        throw Error(
          "Complete os cinco eixos de revisão humana antes da assinatura.",
        );
    }
    if (stage === "Concluído") {
      if (!doc?.signed)
        throw Error("Anexe o documento assinado antes de concluir.");
      const terms = JSON.parse(d.data);
      const contract = one(
        "SELECT * FROM contract_registry WHERE id=?",
        d.contract_id,
      );
      if (contract?.instrument_kind === "Aditivo")
        run(
          "INSERT INTO signed_history VALUES(?,?,?,?,?,?,?,?)",
          id(),
          contract.parent_id,
          contract.sequence,
          "Registro local",
          "Documento " + doc.id,
          terms.dataFormalizacao,
          user.id,
          now(),
        );
      run(
        "UPDATE contracts SET status=?,start=?,end=? WHERE id=?",
        contract?.instrument_kind === "Operação jurídica"
          ? "Concluído"
          : "Assinado",
        terms.inicio || null,
        terms.fim || null,
        d.contract_id,
      );
      const sourceStatus: Record<string, string> = {
        Distrato: "Distratado",
        Descredenciamento: "Descredenciado",
        "Migração de modalidade": "Migrado",
      };
      if (sourceStatus[d.type]) {
        if (d.type === "Migração de modalidade" && required(d).length)
          throw Error(
            "Conclua os requisitos e as demandas vinculadas antes de encerrar a migração.",
          );
        const matrix = one(
          "SELECT * FROM contract_registry WHERE id=? AND school_id=? AND instrument_kind='Matriz'",
          terms.matriz || "",
          d.school_id,
        );
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
        run(
          "UPDATE contracts SET status=? WHERE id=?",
          sourceStatus[d.type],
          matrix.id,
        );
        audit(d.id, user.id, `Matriz ${matrix.id}: ${sourceStatus[d.type]}`);
      }
    }
  }
  run(
    "UPDATE demands SET stage=?,completed=? WHERE id=?",
    stage,
    stage === "Concluído" ? now() : null,
    d.id,
  );
  audit(d.id, user.id, `Etapa: ${stage}${reason ? " • " + reason : ""}`);
}
