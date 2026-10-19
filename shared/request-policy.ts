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
export function requiredFor(type: string, subtype = "", modality = "") {
  if (type !== "Aditivo")
    return Array.from(
      new Set([
        ...requiredDataFields,
        ...(type === "Contrato de garantia" ? officialRequired(type, "", modality) : []),
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
  return officialRequired(type, subtype, modality).filter((key) => key in officialInputs);
}
export function previousKey(key: string) {
  return "anterior" + key[0].toUpperCase() + key.slice(1);
}
