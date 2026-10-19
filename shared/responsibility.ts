/** Responsibility matrix taken from the Kedu contracts manual v2 (sections 3, 4.2, 5, 8, 9 and 11).
 * "valida" drives the approvals the system requires; executors and observers are informative.
 * Rows marked with a note have ambiguous or conflicting wording in the manual and need team validation. */
export type Responsibility = {
  executa: string;
  valida: string[];
  observadores: string;
  fonte: string;
  nota?: string;
};
export const responsibilityMatrix: Record<string, Responsibility> = {
  "Aditivo simples": {
    executa: "Comercial / CS / CX",
    valida: ["Risco"],
    observadores: "Financeiro; Jurídico (cópia do chamado)",
    fonte: "Manual §3 e §5.2",
  },
  "Aditivo — Conta bancária": {
    executa: "Comercial / CS / CX",
    valida: ["Risco", "Financeiro"],
    observadores: "Jurídico (cópia do chamado)",
    fonte: "Manual §5.2",
  },
  "Contrato de garantia": {
    executa: "Comercial / CS",
    valida: ["Risco"],
    observadores: "Jurídico; Financeiro",
    fonte: "Manual §3, §4.2 e §11",
    nota: "Jurídico é acionado nos casos do §5.3/§6 (exceções registradas no controle jurídico).",
  },
  "Contrato de garantia — Garantia Prevista": {
    executa: "Comercial / CS",
    valida: ["Risco", "Jurídica"],
    observadores: "Financeiro",
    fonte: "Manual §3 (linha 'Banking Prevista/migração') e §7.3",
    nota: "A tabela do manual indica execução pelo Jurídico para Prevista, mas o §4.2 trata as três modalidades juntas. Mantido o controle jurídico até validação da equipe.",
  },
  "Migração de modalidade": {
    executa: "Jurídico",
    valida: ["Risco", "Jurídica"],
    observadores: "Financeiro",
    fonte: "Manual §4.3 e §6 item 1",
    nota: "Não é aditivo simples: exige distrato e novo contrato vinculados.",
  },
  "Antecipação K-invest": {
    executa: "Jurídico",
    valida: ["Jurídica", "Financeiro"],
    observadores: "Área solicitante",
    fonte: "Manual §3, §9 e B.4",
  },
  Parcelamento: {
    executa: "Jurídico",
    valida: ["Jurídica", "Financeiro"],
    observadores: "Área solicitante",
    fonte: "Manual §3, §9 e B.4",
  },
  Distrato: {
    executa: "Jurídico",
    valida: ["Jurídica", "Financeiro"],
    observadores: "Financeiro e Jurídico obrigatórios no chamado",
    fonte: "Manual §8.2 e B.3",
    nota: "O manual fala em 'ciência do Financeiro'; registrada como validação Financeiro.",
  },
  Descredenciamento: {
    executa: "Área solicitante / Jurídico",
    valida: ["Jurídica"],
    observadores: "Financeiro",
    fonte: "Manual §3 e §8.1",
  },
  "CNPJ solidário": {
    executa: "Jurídico",
    valida: ["Risco", "Jurídica"],
    observadores: "Financeiro",
    fonte: "Manual §5.3, §6 item 2 e §13.2",
  },
  "Renovação com pendências": {
    executa: "Jurídico",
    valida: ["Risco", "Jurídica"],
    observadores: "Financeiro",
    fonte: "Manual §5.3 e §6 item 7",
  },
  "Alteração societária": {
    executa: "Jurídico",
    valida: ["Risco", "Jurídica"],
    observadores: "Financeiro",
    fonte: "Manual §5.3 e §6 item 9",
  },
  "Contrato educacional": {
    executa: "Área solicitante",
    valida: ["Jurídica"],
    observadores: "Financeiro",
    fonte: "Manual §3 e §11 (Contratos diversos)",
  },
  "Contrato marketing": {
    executa: "Marketing / área solicitante",
    valida: ["Jurídica"],
    observadores: "Financeiro",
    fonte: "Manual §3 e §11 (Contratos diversos)",
  },
  "Contrato fornecedor": {
    executa: "Área solicitante",
    valida: ["Jurídica"],
    observadores: "Financeiro",
    fonte: "Manual §3 e §11 (Análise de fornecedor)",
  },
};
export function responsibilityFor(type: string, subtype = "", modality = "") {
  if (type === "Aditivo")
    return responsibilityMatrix[subtype === "Conta bancária" ? "Aditivo — Conta bancária" : "Aditivo simples"];
  if (type === "Contrato de garantia" && modality === "Garantia Prevista")
    return responsibilityMatrix["Contrato de garantia — Garantia Prevista"];
  return responsibilityMatrix[type] || { executa: "—", valida: ["Risco", "Jurídica"], observadores: "—", fonte: "Sem regra específica no manual", nota: "Tipo sem regra própria: Risco e Jurídico por precaução." };
}
/** Conflicts between the manuals and the approved Canva models, kept visible for team validation. */
export const documentConflicts = [
  "Título dos aditivos: o Canva traz '(DIGITAR O Nº ORDINAL DO ADITIVO) CONTRATO DE GESTÃO…'; o manual dos modelos usa 'SEGUNDO ADITIVO AO CONTRATO…'. O sistema preenche o ordinal como 'SEGUNDO ADITIVO AO', reproduzindo o manual sem alterar o corpo do Canva.",
  "Contratante: o manual prevê tipo societário e representação por procurador (livro, folha e cartório); os modelos do Canva não têm esses campos. Representação por procurador exige encaminhamento ao Jurídico.",
  "Aditivo de conta bancária: o manual inclui PIX e um aviso sobre conta de terceiro; o Canva não tem campo PIX nem o aviso. A exigência de procuração pública continua aplicada como evidência.",
  "Aditivos de cashback, conta bancária e repasse no Canva mencionam '2 (duas) testemunhas abaixo nomeadas', sem campos de testemunha no documento; os de vigência e taxa não mencionam testemunhas.",
  "Aditivo de cashback: o manual cita a cláusula 3.8 e a natureza da alteração; o Canva usa redação curta ('referente às Informações Adicionais').",
  "Aditivo de repasse: o Canva prevê dois repasses mensais; o manual não define se os percentuais devem somar 100%. O sistema não aplica essa regra.",
  "Contratos Garantia Completa e Conjunta fixam início e fim da vigência no dia 01; datas em outro dia exigem ajuste ou Jurídico.",
  "Contrato Garantia Prevista (cláusula 3.6.2) repete a numeração '3.6.2.' no texto da fonte; preservado sem correção.",
];
