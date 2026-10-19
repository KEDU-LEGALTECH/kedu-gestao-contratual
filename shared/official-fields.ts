import {
  cardinal,
  dateWords,
  monthName,
  moneyDisplay,
  moneyWords,
  ordinal,
  percentWords,
  wholeMonths,
  yearOf,
} from "./extenso.js";

/** Inputs typed by people for the official Canva models (beyond the legacy fields). */
export const officialInputs: Record<string, string> = {
  nomeFantasia: "Nome fantasia",
  rua: "Rua / logradouro",
  numero: "Número",
  bairro: "Bairro",
  cidade: "Cidade",
  estado: "Estado (UF)",
  cep: "CEP",
  representanteNome: "Representante legal",
  representanteCpf: "CPF do representante",
  duracaoMeses: "Duração em meses",
  alunos: "Quantidade de alunos",
  incorporaMatricula: "Incorpora matrícula (Sim ou Não)",
  parcelas: "Quantidade de parcelas de repasse",
  diaRepasse: "Dia do (primeiro) repasse",
  repasseSegundo: "Percentual do segundo repasse",
  diaSegundoRepasse: "Dia do segundo repasse",
};
/** Values computed by the system; never typed and never accepted from the client. */
export const officialDerived = [
  "avisoHomologacao",
  "ordinalAditivo",
  "dataAssinaturaMatrizExtenso",
  "dataFormalizacaoExtenso",
  "inicioExtenso",
  "fimExtenso",
  "inicioMes",
  "inicioAno",
  "fimMes",
  "fimAno",
  "diaRepasseExtenso",
  "diaSegundoRepasseExtenso",
  "parcelasExtenso",
  "duracaoExtenso",
  "taxaExtenso",
  "repasseExtenso",
  "repasseSegundoExtenso",
  "percentualRestante",
  "restanteExtenso",
  "valorExtenso",
];
export const officialSlotKeys = [
  ...Object.keys(officialInputs),
  ...officialDerived,
  "razaoSocial",
  "cnpj",
  "remuneracao",
  "garantia",
  "repasse",
  "valor",
  "banco",
  "agencia",
  "conta",
  "titularConta",
  "documentoTitular",
  "pix",
  "cashbackValor",
];
export const homologationNotice =
  "MINUTA PARA HOMOLOGAÇÃO — MODELO PENDENTE DE HOMOLOGAÇÃO JURÍDICA — NÃO UTILIZAR PARA ASSINATURA";
export const previewNotice = "PRÉVIA PARA CONFERÊNCIA — NÃO UTILIZAR PARA ASSINATURA";

const party = [
  "razaoSocial",
  "nomeFantasia",
  "cnpj",
  "rua",
  "numero",
  "bairro",
  "cidade",
  "estado",
  "cep",
  "representanteNome",
  "representanteCpf",
  "dataFormalizacao",
];
const addendumBase = [...party, "dataAssinaturaMatriz"];
/** Inputs each official model needs, by subtype (addenda) or modality (contracts). */
export const officialRequirements: Record<string, string[]> = {
  Vigência: [...addendumBase, "inicio", "fim", "duracaoMeses"],
  Cashback: [...addendumBase, "cashbackValor"],
  "Conta bancária": [...addendumBase, "banco", "agencia", "conta", "titularConta", "documentoTitular"],
  "Taxa de remuneração": [...addendumBase, "remuneracao"],
  "Percentual/data de repasse": [
    ...addendumBase,
    "parcelas",
    "repasse",
    "diaRepasse",
    "repasseSegundo",
    "diaSegundoRepasse",
  ],
};
const contractBase = [
  ...party,
  "alunos",
  "incorporaMatricula",
  "cashbackValor",
  "remuneracao",
  "valor",
  "inicio",
  "fim",
  "duracaoMeses",
  "banco",
  "conta",
  "agencia",
  "titularConta",
  "documentoTitular",
  "parcelas",
  "repasse",
  "diaRepasse",
];
export const contractRequirements: Record<string, string[]> = {
  "Garantia Completa": contractBase,
  "Garantia Conjunta": contractBase,
  "Garantia Prevista": [...contractBase, "garantia"],
};
export function officialRequired(type: string, subtype = "", modality = "") {
  if (type === "Aditivo") return officialRequirements[subtype] || [];
  if (type === "Contrato de garantia") return contractRequirements[modality] || contractBase;
  return [];
}

const filled = (data: Record<string, any>, key: string) =>
  typeof data[key] === "string" && data[key].trim() !== "";
/** Consistency problems that block generation; nothing is guessed or auto-corrected. */
export function officialProblems(type: string, subtype: string, data: Record<string, any>) {
  const problems: string[] = [];
  const modality = data.modalidade || "";
  const keys = officialRequired(type, subtype, modality);
  if (keys.includes("duracaoMeses") && filled(data, "inicio") && filled(data, "fim") && filled(data, "duracaoMeses")) {
    try {
      const months = wholeMonths(data.inicio, data.fim);
      if (months === null)
        problems.push(
          "Início e fim da vigência não correspondem a meses inteiros; confirme as datas exatas antes de informar a duração",
        );
      else if (String(months) !== String(Number(data.duracaoMeses)))
        problems.push(`Duração informada (${data.duracaoMeses} meses) difere do intervalo entre início e fim (${months} meses)`);
    } catch {
      /* Invalid dates are reported by the field validation. */
    }
  }
  if (
    type === "Contrato de garantia" &&
    ["Garantia Completa", "Garantia Conjunta"].includes(modality) &&
    ["inicio", "fim"].some((k) => filled(data, k) && /^\d{4}-\d{2}-\d{2}$/.test(data[k]) && !data[k].endsWith("-01"))
  )
    problems.push("O modelo de " + modality + " fixa início e fim no dia 01; ajuste as datas ou submeta ao Jurídico");
  return problems;
}

type DeriveContext = { sequence?: number | null; notice: string };
/** Builds every template value from confirmed data. Missing inputs stay missing. */
export function deriveOfficial(data: Record<string, any>, context: DeriveContext) {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) if (typeof value === "string") out[key] = value.trim();
  const set = (key: string, source: string, fn: (v: string) => string) => {
    if (filled(data, source)) out[key] = fn(String(data[source]).trim());
  };
  out.avisoHomologacao = context.notice;
  if (context.sequence) out.ordinalAditivo = ordinal(context.sequence).toUpperCase() + " ADITIVO AO";
  set("dataAssinaturaMatrizExtenso", "dataAssinaturaMatriz", dateWords);
  set("dataFormalizacaoExtenso", "dataFormalizacao", dateWords);
  set("inicioExtenso", "inicio", dateWords);
  set("fimExtenso", "fim", dateWords);
  set("inicioMes", "inicio", monthName);
  set("inicioAno", "inicio", yearOf);
  set("fimMes", "fim", monthName);
  set("fimAno", "fim", yearOf);
  set("duracaoExtenso", "duracaoMeses", (v) => cardinal(Number(v)));
  set("parcelasExtenso", "parcelas", (v) => cardinal(Number(v), "f"));
  set("diaRepasseExtenso", "diaRepasse", (v) => cardinal(Number(v)));
  set("diaSegundoRepasseExtenso", "diaSegundoRepasse", (v) => cardinal(Number(v)));
  set("taxaExtenso", "remuneracao", percentWords);
  set("repasseExtenso", "repasse", percentWords);
  set("repasseSegundoExtenso", "repasseSegundo", percentWords);
  set("valorExtenso", "valor", moneyWords);
  set("valor", "valor", moneyDisplay);
  set("cashbackValor", "cashbackValor", moneyDisplay);
  if (filled(data, "garantia")) {
    const m = /^(\d{1,3}),(\d{2})%$/.exec(data.garantia.trim());
    if (m) {
      const rest = 10000 - (Number(m[1]) * 100 + Number(m[2]));
      if (rest >= 0) {
        out.percentualRestante = Math.floor(rest / 100) + "," + String(rest % 100).padStart(2, "0") + "%";
        out.restanteExtenso = percentWords(out.percentualRestante);
      }
    }
  }
  if (filled(data, "diaRepasse")) out.diaRepasse = String(Number(data.diaRepasse));
  if (filled(data, "diaSegundoRepasse")) out.diaSegundoRepasse = String(Number(data.diaSegundoRepasse));
  return out;
}
