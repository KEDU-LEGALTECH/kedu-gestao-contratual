export const requiredDataFields = [
  "cnpj",
  "razaoSocial",
  "remuneracao",
  "garantia",
  "repasse",
  "valor",
  "banco",
  "agencia",
  "conta",
  "inicio",
  "fim",
  "dataRepasse",
  "modalidade",
  "endereco",
  "dataFormalizacao",
  "localidade",
];
export function validateData(values: Record<string, unknown>) {
  const errors: Record<string, string> = {};
  const text = (key: string) => String(values[key] ?? "").trim();
  if (
    text("documentoTitular") &&
    !/^(?:\d{3}\.\d{3}\.\d{3}-\d{2}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})$/.test(
      text("documentoTitular"),
    )
  )
    errors.documentoTitular =
      "Informe CPF no formato 000.000.000-00 ou CNPJ no formato 00.000.000/0000-00.";
  const integer = (key: string, min: number, max: number, message: string) => {
    const value = text(key);
    if (value && (!/^\d{1,6}$/.test(value) || Number(value) < min || Number(value) > max))
      errors[key] = message;
  };
  integer("duracaoMeses", 1, 240, "Informe a duração em meses (número inteiro entre 1 e 240).");
  integer("alunos", 1, 200000, "Informe a quantidade de alunos como número inteiro.");
  integer("parcelas", 1, 12, "Informe a quantidade de parcelas (1 a 12).");
  integer("diaRepasse", 1, 31, "Informe o dia do mês (1 a 31).");
  integer("diaSegundoRepasse", 1, 31, "Informe o dia do mês (1 a 31).");
  if (text("cep") && !/^\d{5}-\d{3}$/.test(text("cep")))
    errors.cep = "Use o formato 00000-000.";
  if (text("estado") && !/^[A-Za-zÀ-ÿ ]{2,30}$/.test(text("estado")))
    errors.estado = "Informe o estado, preferencialmente por extenso, por exemplo: Ceará.";
  if (text("representanteCpf") && !/^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(text("representanteCpf")))
    errors.representanteCpf = "Use o formato 000.000.000-00.";
  if (text("incorporaMatricula") && !["Sim", "Não"].includes(text("incorporaMatricula")))
    errors.incorporaMatricula = "Informe Sim ou Não.";
  for (const key of ["remuneracao", "garantia", "repasse", "repasseSegundo", "cashback"]) {
    const value = text(key);
    if (!value) continue;
    const match = /^(\d{1,3}),(\d{2})%$/.exec(value);
    if (!match)
      errors[key] =
        "Use duas casas decimais e o símbolo %, por exemplo: 3,30%.";
    else if (Number(match[1]) * 100 + Number(match[2]) > 10000)
      errors[key] = "Informe um percentual entre 0,00% e 100,00%.";
  }
  if (text("cnpj") && !/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(text("cnpj")))
    errors.cnpj = "Use o formato 00.000.000/0000-00.";
  for (const key of ["valor", "cashbackValor"])
    if (text(key)) {
      const match = /^(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})$/.exec(
        text(key),
      );
      if (!match)
        errors[key] =
          "Informe um valor em reais com duas casas decimais, por exemplo: 10000,00.";
      else {
        const units =
          Number(match[1].replaceAll(".", "")) * 100 + Number(match[2]);
        if (!Number.isSafeInteger(units) || units > 1_000_000_000_000)
          errors[key] = "Valor excede o limite suportado.";
      }
    }
  for (const key of [
    "inicio",
    "fim",
    "dataRepasse",
    "dataAssinaturaMatriz",
    "dataFormalizacao",
  ]) {
    const value = text(key);
    if (
      value &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(Date.parse(value)) ||
        new Date(value).toISOString().slice(0, 10) !== value)
    )
      errors[key] = "Informe uma data válida.";
  }
  if (text("inicio") && text("fim") && text("inicio") > text("fim"))
    errors.fim = "O fim da vigência não pode ser anterior ao início.";
  if (
    text("modalidade") &&
    !["Garantia Completa", "Garantia Conjunta", "Garantia Prevista"].includes(
      text("modalidade"),
    )
  )
    errors.modalidade = "Selecione uma modalidade válida.";
  return errors;
}
