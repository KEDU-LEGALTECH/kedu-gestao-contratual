import { all, one, run, localDate, id, now } from "./db.js";
import { requiredFor } from "../shared/request-policy.js";
import { officialProblems } from "../shared/official-fields.js";
import { responsibilityFor } from "../shared/responsibility.js";
import { analyzeTicket, crossCheck } from "./glpi-analysis.js";
export const subtypes = [
  "Conta bancária",
  "Vigência",
  "Percentual/data de repasse",
  "Cashback",
  "Taxa de remuneração",
];
export const modalities = [
  "Garantia Completa",
  "Garantia Conjunta",
  "Garantia Prevista",
];
export const documentTypes = [
  "Contrato de garantia",
  "Contrato educacional",
  "Contrato fornecedor",
  "Contrato marketing",
  "Aditivo",
  "CNPJ solidário",
  "Antecipação K-invest",
  "Parcelamento",
  "Migração de modalidade",
  "Distrato",
  "Descredenciamento",
  "Renovação com pendências",
  "Alteração societária",
];
export const matrixCases = [
  "CNPJ solidário",
  "Antecipação K-invest",
  "Parcelamento",
  "Migração de modalidade",
  "Distrato",
  "Descredenciamento",
  "Renovação com pendências",
  "Alteração societária",
];
export const evidenceLabels: Record<string, string> = {
  contrato_social: "Contrato social e alterações societárias",
  identificacao: "Identificação do responsável legal",
  cartao_cnpj: "Cartão CNPJ e conferência cadastral na Receita Federal",
  comprovante_bancario: "Comprovante bancário conferido",
  procuracao_bancaria: "Procuração pública específica para conta de terceiro",
  assuncao_divida: "Anexo de assunção da dívida pela matriz/presidência",
  matriz_assinada: "Contrato matriz assinado",
  historico_aditivos: "Histórico do último aditivo assinado",
  confissao_divida: "Confissão de Dívida",
  nexo_economico: "Comprovação do nexo de atividade econômica",
  distrato: "Distrato da modalidade anterior",
  novo_contrato: "Novo contrato da modalidade de destino",
  contratos_anteriores: "Contratos anteriores mencionados na renovação",
  pendencias_financeiras: "Demonstrativo das pendências financeiras",
};
export const humanAxes = [
  "Estrutura do documento",
  "Dados e consistência",
  "Tipo e autorização",
  "Português e redação",
  "Assinaturas",
];
export function nextReport(today = localDate()) {
  const d = new Date(today + "T12:00:00Z");
  const days = (5 - d.getUTCDay() + 7) % 7;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function reviewDeadline(report: string) {
  const d = new Date(report + "T12:00:00Z");
  if (Number.isNaN(d.valueOf()) || d.getUTCDay() !== 5)
    throw Error("O reporte semanal deve ocorrer numa sexta-feira.");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
export function details(d: any) {
  return JSON.parse(
    one("SELECT payload FROM case_details WHERE demand_id=?", d.id)?.payload ||
      "{}",
  );
}
export function saveDetails(demandId: string, payload: any) {
  run(
    "INSERT INTO case_details VALUES(?,?) ON CONFLICT(demand_id) DO UPDATE SET payload=excluded.payload",
    demandId,
    JSON.stringify(payload),
  );
}
export function requirements(d: any) {
  const g = details(d);
  const custom = JSON.parse(
    one("SELECT value FROM settings WHERE key=?", "legalPolicies")?.value ||
      "[]",
  );
  const flags = [
    ...(g.legalFlags || []),
    ...(g.systemLegalFlags || []),
  ] as string[];
  const data = JSON.parse(d.data || "{}");
  // Validators come from the manual's responsibility matrix; legal exceptions add the legal control point.
  const responsibility = responsibilityFor(d.type, g.subtype, data.modalidade || "");
  const approvals = [...responsibility.valida];
  const exception =
    (d.type === "Aditivo" && !subtypes.includes(g.subtype)) ||
    flags.length > 0 ||
    custom.includes(g.subtype) ||
    custom.includes(d.type) ||
    flags.some((x) => custom.includes(x));
  if (exception) {
    if (!approvals.includes("Risco") && ["Aditivo", "Contrato de garantia"].includes(d.type))
      approvals.unshift("Risco");
    if (!approvals.includes("Jurídica")) approvals.push("Jurídica");
  }
  const legal = approvals.includes("Jurídica");
  const evidence = [
    "contrato_social",
    "identificacao",
    "cartao_cnpj",
    "comprovante_bancario",
  ];
  if (
    data.contaTerceiro === true ||
    (data.documentoTitular &&
      data.cnpj &&
      data.documentoTitular.replace(/\D/g, "") !== data.cnpj.replace(/\D/g, ""))
  )
    evidence.push("procuracao_bancaria");
  if (data.modalidade === "Garantia Prevista") evidence.push("assuncao_divida");
  if (matrixCases.includes(d.type)) evidence.push("matriz_assinada");
  if (d.type === "Aditivo")
    evidence.push("matriz_assinada", "historico_aditivos");
  if (["Antecipação K-invest", "Parcelamento"].includes(d.type))
    evidence.push("confissao_divida");
  if (d.type === "CNPJ solidário") evidence.push("nexo_economico");
  if (d.type === "Migração de modalidade")
    evidence.push("distrato", "novo_contrato");
  if (
    d.type === "Renovação com pendências" ||
    flags.includes("Renovação com pendências")
  )
    evidence.push("contratos_anteriores", "pendencias_financeiras");
  if (flags.includes("Renovação com contratos anteriores"))
    evidence.push("matriz_assinada", "contratos_anteriores");
  return {
    approvals,
    evidence: Array.from(new Set(evidence)),
    legal,
    responsibility,
    subtype: g.subtype || "",
    reviewDeadline: g.reportDate ? reviewDeadline(g.reportDate) : null,
  };
}
/** Divergences between the demand and the GLPI ticket it was imported from. */
export function ticketCrossCheck(d: any, data: any) {
  const ticket = d.glpi_id
    ? one("SELECT payload FROM glpi_tickets WHERE external_id=? AND demand_id=?", d.glpi_id, d.id)
    : null;
  if (!ticket) return [];
  const analysis = analyzeTicket(JSON.parse(ticket.payload), { schools: [], matrices: [] });
  return crossCheck(analysis, d.glpi_id, data);
}
export function governanceMissing(d: any) {
  const g = details(d),
    r = requirements(d),
    data = JSON.parse(d.data),
    missing: string[] = [];
  if (!d.glpi_id) missing.push("Número do chamado GLPI");
  if (!g.reportDate) missing.push("Sexta-feira de reporte");
  if (d.type === "Aditivo" && !subtypes.includes(g.subtype))
    missing.push("Tipo específico de aditivo");
  if (
    d.type === "Contrato de garantia" ||
    d.type === "Migração de modalidade"
  ) {
    if (!modalities.includes(data.modalidade))
      missing.push("Modalidade de garantia válida");
  }
  for (const [key, label] of [
    ["endereco", "Endereço da escola"],
    ["dataFormalizacao", "Data de formalização"],
    ["localidade", "Localidade de formalização"],
  ])
    if (!data[key]) missing.push(label);
  if (data.localidade && data.localidade !== "Fortaleza, CE")
    missing.push("Formalização em Fortaleza, CE");
  if (
    data.modalidade === "Garantia Completa" &&
    data.garantia &&
    data.garantia !== "100,00%"
  )
    missing.push("Garantia Completa exige garantia de 100,00%");
  if (matrixCases.includes(d.type)) {
    const matrix = one(
      "SELECT * FROM contracts WHERE id=? AND school_id=?",
      data.matriz || "",
      d.school_id,
    );
    if (
      !matrix ||
      matrix.parent_id ||
      matrix.id === d.contract_id ||
      matrix.status !== "Assinado"
    )
      missing.push(
        "Contrato matriz assinado da escola para a operação jurídica",
      );
    if (!data.dataAssinaturaMatriz)
      missing.push("Data de assinatura do contrato matriz");
  }
  if (
    d.type === "CNPJ solidário" &&
    !/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(data.cnpjSolidario || "")
  )
    missing.push("CNPJ solidário no formato válido");
  if (d.type === "Aditivo") {
    if (
      one(
        "SELECT subtype FROM demand_baselines WHERE demand_id=? ORDER BY rowid DESC LIMIT 1",
        d.id,
      )?.subtype !== g.subtype
    )
      missing.push("Conferir e confirmar os dados atuais do contrato matriz");
    if (!data.motivo?.trim()) missing.push("Motivo da alteração");
    if (!data.dataAssinaturaMatriz)
      missing.push("Data de assinatura do contrato matriz");
    const c = one("SELECT * FROM contracts WHERE id=?", d.contract_id);
    if (!c?.parent_id) missing.push("Contrato matriz vinculado");
    else {
      const h = one(
        "SELECT * FROM signed_history WHERE matrix_id=? ORDER BY sequence DESC LIMIT 1",
        c.parent_id,
      );
      if (!h)
        missing.push("Último aditivo assinado confirmado no Clicksign/Clint");
      else if (
        !(
          d.stage === "Concluído" &&
          one(
            "SELECT id FROM signed_history WHERE matrix_id=? AND sequence=?",
            c.parent_id,
            c.sequence,
          )
        ) &&
        c.sequence !== h.sequence + 1
      )
        missing.push(
          "Sequência deve suceder o último assinado confirmado; reservas/cancelamentos exigem reconciliação",
        );
    }
  }
  missing.push(...officialProblems(d.type, g.subtype || "", data));
  missing.push(...ticketCrossCheck(d, data));
  if (d.type === "Migração de modalidade") {
    // Manual §4.3: migration is never a simple addendum; it needs a distrato and a new contract.
    for (const [key, type, label] of [
      ["demandaDistrato", "Distrato", "Demanda de distrato do contrato vigente vinculada"],
      ["demandaNovoContrato", "Contrato de garantia", "Demanda do novo contrato na modalidade de destino vinculada"],
    ]) {
      const linked = one(
        "SELECT * FROM demands WHERE id=? AND school_id=? AND type=?",
        data[key] || "",
        d.school_id,
        type,
      );
      if (!linked) missing.push(label);
      else if (d.stage === "Em assinatura" && linked.stage !== "Concluído")
        missing.push(label.replace(" vinculada", "") + " concluída antes de encerrar a migração");
    }
  }
  const normalize = (name: string) =>
    String(name || "")
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  if (
    data.representanteNome?.trim() &&
    (g.signers || []).length &&
    !(g.signers || []).some((s: any) => normalize(s.name) === normalize(data.representanteNome))
  )
    missing.push("Representante legal do documento deve constar entre os signatários com poderes conferidos");
  for (const kind of r.evidence)
    if (
      !one(
        "SELECT id FROM evidence_files WHERE demand_id=? AND kind=? AND verified_by IS NOT NULL AND rowid=(SELECT MAX(rowid) FROM evidence_files WHERE demand_id=? AND kind=?)",
        d.id,
        kind,
        d.id,
        kind,
      )
    )
      missing.push(evidenceLabels[kind]);
  const signers = g.signers || [];
  if (!g.signingMode) missing.push("Regra de poderes de assinatura");
  if (!signers.length) missing.push("Signatários da escola");
  if (
    g.signingMode === "Administrador nomeado" &&
    (signers.length !== 1 || signers[0].capacity !== "Administrador")
  )
    missing.push("Somente o administrador nomeado deve assinar");
  if (
    g.signingMode === "Todos os sócios" &&
    (!g.partnerCount ||
      signers.length !== g.partnerCount ||
      signers.some((s: any) => s.capacity !== "Sócio"))
  )
    missing.push("Todos os sócios devem constar como signatários");
  if (signers.some((s: any) => !s.name?.trim() || !s.email?.includes("@")))
    missing.push("Nome e e-mail dos signatários");
  return missing;
}
export function checksFor(doc: any) {
  if (!doc) return [];
  return all(
    "SELECT h.*,u.name FROM human_checks h JOIN users u ON u.id=h.user_id WHERE document_id=? AND data_version=? ORDER BY h.created DESC,h.rowid DESC",
    doc.id,
    doc.data_version,
  ).map((check) => ({
    ...check,
    issues: all(
      "SELECT location,problem,correction,severity FROM human_issues WHERE check_id=?",
      check.id,
    ),
  }));
}
export function humanMissing(doc: any) {
  const checks = checksFor(doc);
  return humanAxes.filter((axis) => {
    const c = checks.find((c) => c.axis === axis);
    return !c || c.result === "Reprovado";
  });
}
export function legalReport(d: any, doc: any) {
  const checks = checksFor(doc),
    review = doc
      ? one(
          "SELECT * FROM reviews WHERE document_id=? ORDER BY created DESC LIMIT 1",
          doc.id,
        )
      : null;
  const findings = review ? JSON.parse(review.results) : [];
  const missing = [
    ...governanceMissing(d),
    ...humanMissing(doc).map((a) => "Revisão humana: " + a),
  ];
  const data = JSON.parse(d.data);
  for (const key of requiredFor(d.type, requirements(d).subtype, data.modalidade || ""))
    if (typeof data[key] !== "string" || !data[key].trim())
      missing.push("Campo obrigatório: " + key);
  if (!data.checklist) missing.push("Confirmar recebimento da documentação");
  if (!d.confirmed) missing.push("Confirmar dados críticos atuais");
  if (doc && doc.data_version !== d.data_version)
    missing.push("Minuta desatualizada em relação aos dados atuais");
  if (doc)
    for (const kind of requirements(d).approvals)
      if (
        !one(
          "SELECT id FROM approvals WHERE document_id=? AND data_version=? AND kind=? AND valid=1",
          doc.id,
          d.data_version,
          kind,
        )
      )
        missing.push("Validação obrigatória: " + kind);
  const status =
    !doc || !review || review.status !== "conforme" || missing.length
      ? "REPROVADO"
      : checks.some(
            (c) =>
              c.result === "Aprovado com ressalvas" &&
              checks.find((x) => x.axis === c.axis)?.id === c.id,
          )
        ? "APROVADO COM RESSALVAS"
        : "APROVADO";
  return {
    title: "RELATÓRIO DE REVISÃO JURÍDICA",
    document: d.type + " — " + d.id,
    date: localDate(),
    documentVersion: doc?.version || null,
    dataVersion: d.data_version,
    status,
    axes: humanAxes.map((axis) => ({
      axis,
      check: checks.find((c) => c.axis === axis) || null,
    })),
    findings,
    missing,
    disclaimer:
      "Resultado de conferências estruturais e validações humanas registradas; não constitui parecer jurídico automático.",
  };
}
