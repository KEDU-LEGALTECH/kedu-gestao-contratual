export const requiredDataFields = ["cnpj", "razaoSocial", "remuneracao", "garantia", "repasse", "valor", "banco", "agencia", "conta", "inicio", "fim", "dataRepasse", "modalidade", "endereco", "dataFormalizacao", "localidade"];
export function validateData(values: Record<string, unknown>) {
  const errors: Record<string, string> = {};
  const text = (key: string) => String(values[key] ?? "").trim();
  for (const key of ["remuneracao", "garantia", "repasse", "cashback"]) {
    const value = text(key);
    if (!value) continue;
    const match = /^(\d{1,3}),(\d{2})%$/.exec(value);
    if (!match) errors[key] = "Use duas casas decimais e o símbolo %, por exemplo: 3,30%.";
    else if (Number(match[1]) * 100 + Number(match[2]) > 10000) errors[key] = "Informe um percentual entre 0,00% e 100,00%.";
  }
  if (text("cnpj") && !/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(text("cnpj"))) errors.cnpj = "Use o formato 00.000.000/0000-00.";
  if (text("valor")) {
    const match = /^(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})$/.exec(text("valor"));
    if (!match) errors.valor = "Use duas casas decimais, por exemplo: 10000,00.";
    else {
      const units = Number(match[1].replaceAll(".", "")) * 100 + Number(match[2]);
      if (!Number.isSafeInteger(units) || units > 1_000_000_000_000) errors.valor = "Valor excede o limite suportado.";
    }
  }
  for (const key of ["inicio", "fim", "dataRepasse", "dataAssinaturaMatriz", "dataFormalizacao"]) {
    const value = text(key);
    if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) errors[key] = "Informe uma data válida.";
  }
  if (text("inicio") && text("fim") && text("inicio") > text("fim")) errors.fim = "O fim da vigência não pode ser anterior ao início.";
  if (text("modalidade") && !["Garantia Completa", "Garantia Conjunta", "Garantia Prevista"].includes(text("modalidade"))) errors.modalidade = "Selecione uma modalidade válida.";
  return errors;
}
