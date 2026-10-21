import { requiredDataFields } from "./data-validation.js";
import { officialRequired, officialInputs } from "./official-fields.js";

/** Fields that change in each addendum; the confirmed current value is kept as "anterior…". */
export const addendumFields: Record<string, string[]> = {
  "Conta bancária": [
    "banco",
    "agencia",
    "conta",
    "titularConta",
    "documentoTitular",
    "pix",
  ],
  Vigência: ["inicio", "fim", "duracaoMeses"],
  "Percentual/data de repasse": [
    "parcelas",
    "repasse",
    "diaRepasse",
    "repasseSegundo",
    "diaSegundoRepasse",
  ],
  Cashback: ["cashbackValor"],
  "Taxa de remuneração": ["remuneracao"],
};
export const bankFields = [
  "banco",
  "agencia",
  "conta",
  "titularConta",
  "documentoTitular",
  "pix",
];
const identification = [
  "cnpj",
  "razaoSocial",
  "endereco",
  "dataFormalizacao",
  "localidade",
  "motivo",
  "representanteNome",
];
/** Minimum data for each operation; evidence and validators remain in governance. */
export const operationFields: Record<string, string[]> = {
  "Contrato educacional": ["valor", "inicio", "fim"],
  "Contrato fornecedor": ["valor", "inicio", "fim"],
  "Contrato marketing": ["valor", "inicio", "fim"],
  "CNPJ solidário": ["matriz", "dataAssinaturaMatriz", "cnpjSolidario"],
  "Antecipação K-invest": [
    "matriz",
    "dataAssinaturaMatriz",
    "valor",
    "dataRepasse",
  ],
  Parcelamento: [
    "matriz",
    "dataAssinaturaMatriz",
    "valor",
    "parcelas",
    "diaRepasse",
  ],
  "Migração de modalidade": [
    "matriz",
    "dataAssinaturaMatriz",
    "modalidade",
    "demandaDistrato",
    "demandaNovoContrato",
  ],
  Distrato: ["matriz", "dataAssinaturaMatriz"],
  Descredenciamento: ["matriz", "dataAssinaturaMatriz"],
  "Renovação com pendências": [
    "matriz",
    "dataAssinaturaMatriz",
    "inicio",
    "fim",
  ],
  "Alteração societária": ["matriz", "dataAssinaturaMatriz"],
};
export function requiredFor(type: string, subtype = "", modality = "") {
  if (operationFields[type])
    return [...identification, ...operationFields[type]];
  if (type !== "Aditivo")
    return Array.from(
      new Set([
        ...requiredDataFields,
        ...(type === "Contrato de garantia"
          ? officialRequired(type, "", modality)
          : []),
      ]),
    );
  return Array.from(
    new Set([
      "cnpj",
      "razaoSocial",
      "endereco",
      "dataAssinaturaMatriz",
      "dataFormalizacao",
      "localidade",
      "motivo",
      ...(addendumFields[subtype] || []).filter((key) => key !== "pix"),
      ...officialRequired(type, subtype),
    ]),
  );
}
export function visibleFor(type: string, subtype = "", modality = "") {
  if (operationFields[type]) return requiredFor(type, subtype, modality);
  if (type !== "Aditivo") return null;
  return Array.from(
    new Set([
      ...requiredFor(type, subtype, modality),
      ...(addendumFields[subtype] || []),
      "matriz",
      "aditivo",
      "motivo",
    ]),
  );
}
/** Official-model inputs shown in the form for this demand. */
export function officialVisible(type: string, subtype = "", modality = "") {
  return officialRequired(type, subtype, modality).filter(
    (key) => key in officialInputs,
  );
}
export function previousKey(key: string) {
  return "anterior" + key[0].toUpperCase() + key.slice(1);
}
