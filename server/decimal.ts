/** Parse decimal digits directly into integer units; never multiply floating decimals. */
export function basisPoints(text: string): number {
  const m = /^(\d{1,3}),(\d{2})%$/.exec(text);
  if (!m) throw Error("Percentual inválido. Use 7,70%.");
  const n = Number(m[1]) * 100 + Number(m[2]);
  if (n > 10000) throw Error("Percentual deve estar entre 0,00% e 100,00%.");
  return n;
}
export function cents(text: string): number {
  const m = /^(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})$/.exec(text);
  if (!m) throw Error("Valor inválido. Use R$ 10.000,00.");
  const n = Number(m[1].replaceAll(".", "")) * 100 + Number(m[2]);
  if (!Number.isSafeInteger(n) || n > 1_000_000_000_000)
    throw Error("Valor excede o limite suportado.");
  return n;
}
