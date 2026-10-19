/** Brazilian Portuguese spelled-out numbers, dates and values used by the official templates.
 * Pure functions over canonical strings (7,70%; 10.000,00; 2026-11-01): no floating-point math. */
const units = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez",
  "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const tens = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const hundreds = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos",
  "setecentos", "oitocentos", "novecentos"];
export const months = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto",
  "setembro", "outubro", "novembro", "dezembro"];

function feminine(text: string) {
  return text.replace(/\bum\b/g, "uma").replace(/\bdois\b/g, "duas").replace(/entos\b/g, "entas");
}
function belowThousand(n: number): string {
  if (n < 20) return units[n];
  if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? " e " + units[n % 10] : "");
  if (n === 100) return "cem";
  return hundreds[Math.floor(n / 100)] + (n % 100 ? " e " + belowThousand(n % 100) : "");
}
/** Cardinal number in words (0 to 999.999.999.999). */
export function cardinal(n: number, gender: "m" | "f" = "m"): string {
  if (!Number.isSafeInteger(n) || n < 0 || n > 999_999_999_999)
    throw Error("Número fora do intervalo suportado por extenso.");
  if (n < 1000) return gender === "f" ? feminine(belowThousand(n)) : belowThousand(n);
  const groups: [number, string, string][] = [
    [1_000_000_000, "bilhão", "bilhões"],
    [1_000_000, "milhão", "milhões"],
    [1000, "mil", "mil"],
  ];
  const parts: { text: string; count: number }[] = [];
  let rest = n;
  for (const [size, one, many] of groups) {
    const count = Math.floor(rest / size);
    rest %= size;
    if (!count) continue;
    if (size === 1000)
      parts.push({ text: count === 1 ? "mil" : cardinal(count, gender) + " mil", count });
    else parts.push({ text: cardinal(count) + " " + (count === 1 ? one : many), count });
  }
  if (rest) parts.push({ text: cardinal(rest, gender), count: rest });
  // "e" joins only the last group, when it is below one hundred or a round hundred:
  // mil e quinhentos; dois mil trezentos e quarenta; um milhão e duzentos mil.
  return parts
    .map((p, i) =>
      i === 0
        ? p.text
        : (i === parts.length - 1 && (p.count < 100 || p.count % 100 === 0) ? " e " : " ") + p.text,
    )
    .join("");
}
const ordinalUnits = ["", "primeiro", "segundo", "terceiro", "quarto", "quinto", "sexto", "sétimo", "oitavo", "nono"];
const ordinalTens = ["", "décimo", "vigésimo", "trigésimo", "quadragésimo", "quinquagésimo", "sexagésimo",
  "septuagésimo", "octogésimo", "nonagésimo"];
/** Masculine ordinal (1 to 99), e.g. 2 → "segundo", 11 → "décimo primeiro". */
export function ordinal(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 99) throw Error("Ordinal fora do intervalo suportado (1 a 99).");
  return [ordinalTens[Math.floor(n / 10)], ordinalUnits[n % 10]].filter(Boolean).join(" ");
}
/** "7,70%" → "sete inteiros e setenta centésimos por cento"; "100,00%" → "cem por cento". */
export function percentWords(value: string): string {
  const m = /^(\d{1,3}),(\d{2})%$/.exec(value.trim());
  if (!m) throw Error("Percentual inválido para extenso: " + value);
  const whole = Number(m[1]),
    cents = Number(m[2]);
  if (whole * 100 + cents > 10000) throw Error("Percentual acima de 100%.");
  if (!cents) return cardinal(whole) + " por cento";
  const wholeText = whole ? cardinal(whole) + (whole === 1 ? " inteiro" : " inteiros") + " e " : "";
  return wholeText + cardinal(cents) + (cents === 1 ? " centésimo" : " centésimos") + " por cento";
}
/** "10.000,00" or "R$ 10.000,00" → "dez mil reais". */
export function moneyWords(value: string): string {
  const m = /^(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})$/.exec(value.trim());
  if (!m) throw Error("Valor monetário inválido para extenso: " + value);
  const reais = Number(m[1].replaceAll(".", "")),
    cents = Number(m[2]);
  const parts: string[] = [];
  if (reais) {
    const words = cardinal(reais);
    const ofReais = reais >= 1_000_000 && reais % 1_000_000 === 0 ? " de" : "";
    parts.push(words + ofReais + (reais === 1 ? " real" : " reais"));
  }
  if (cents) parts.push(cardinal(cents) + (cents === 1 ? " centavo" : " centavos"));
  return parts.length ? parts.join(" e ") : "zero real";
}
/** Canonical money display: "10000,00" → "R$ 10.000,00". */
export function moneyDisplay(value: string): string {
  const m = /^(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})$/.exec(value.trim());
  if (!m) throw Error("Valor monetário inválido: " + value);
  const digits = String(Number(m[1].replaceAll(".", "")));
  return "R$ " + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "," + m[2];
}
function parseDate(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) throw Error("Data inválida: " + iso);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) throw Error("Data inválida: " + iso);
  return { y, mo, d };
}
/** "2026-11-01" → "1º de novembro de 2026". */
export function dateWords(iso: string): string {
  const { y, mo, d } = parseDate(iso);
  return (d === 1 ? "1º" : String(d)) + " de " + months[mo - 1] + " de " + y;
}
export const monthName = (iso: string) => months[parseDate(iso).mo - 1];
export const yearOf = (iso: string) => String(parseDate(iso).y);
export const dayOf = (iso: string) => parseDate(iso).d;
/** Whole months between start and end when end is the day before the same day N months later
 * (e.g. 2026-11-01 → 2027-10-31 is 12) or the same day N months later; otherwise null. */
export function wholeMonths(start: string, end: string): number | null {
  const a = parseDate(start),
    b = parseDate(end);
  for (let n = 1; n <= 240; n++) {
    const same = new Date(Date.UTC(a.y, a.mo - 1 + n, a.d));
    if (same.getUTCDate() !== a.d) continue;
    const before = new Date(same.getTime() - 86400000);
    const iso = (x: Date) => x.toISOString().slice(0, 10);
    if (iso(before) === end || iso(same) === end) return n;
    if (same.toISOString().slice(0, 10) > end) return null;
  }
  return null;
}
