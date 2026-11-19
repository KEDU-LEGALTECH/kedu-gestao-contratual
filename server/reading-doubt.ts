import { sameRequestedValue } from "./request-expectations.js";

/** Doubts about a value read by OCR that differs from the request. Neither rule accepts the GLPI value:
 * they only keep a probable misreading out of "Aguardando correção" until a person checks the original. */
const percentKeys = new Set(["remuneracao", "garantia", "repasse", "repasseSegundo", "cashback"]);
const moneyKeys = new Set(["valor", "valorTotal", "valorParcela"]);
const integerKeys = new Set(["parcelas", "duracaoMeses"]);
type Kind = "percent" | "money" | "integer";
const kindOf = (key: string): Kind | undefined =>
  percentKeys.has(key) ? "percent" : moneyKeys.has(key) ? "money" : integerKeys.has(key) ? "integer" : undefined;

const numberWords: Record<string, number> = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9,
  dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezasseis: 16,
  dezessete: 17, dezassete: 17, dezoito: 18, dezenove: 19, dezanove: 19, vinte: 20, trinta: 30, quarenta: 40,
  cinquenta: 50, cincoenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90, cem: 100, cento: 100,
  duzentos: 200, duzentas: 200, trezentos: 300, trezentas: 300, quatrocentos: 400, quatrocentas: 400,
  quinhentos: 500, quinhentas: 500, seiscentos: 600, seiscentas: 600, setecentos: 700, setecentas: 700,
  oitocentos: 800, oitocentas: 800, novecentos: 900, novecentas: 900,
};
/** "mil quinhentos e sete" → 1507; undefined when any word is not part of a number. */
function integerWords(tokens: string[]): number | undefined {
  let total = 0, current = 0, seen = false;
  for (const token of tokens) {
    if (token === "e") continue;
    if (token === "mil") { total += (current || 1) * 1000; current = 0; seen = true; continue; }
    if (token === "milhao" || token === "milhoes") { total += (current || 1) * 1_000_000; current = 0; seen = true; continue; }
    if (!(token in numberWords)) return undefined;
    current += numberWords[token];
    seen = true;
  }
  return seen ? total + current : undefined;
}
/** Fraction digits after "vírgula": "oitenta e quatro" → "84", "zero cinco" → "05". */
function fractionWords(tokens: string[]) {
  const words = tokens.filter(t => t !== "e");
  if (words.length > 1 && words.every(t => numberWords[t] !== undefined && numberWords[t] < 10)) return words.map(t => numberWords[t]).join("");
  const n = integerWords(tokens);
  return n === undefined ? undefined : String(n);
}
const cents = (digits: string) => (digits + "00").slice(0, 2);

/** Canonical value of a Portuguese spelled-out number as written beside a figure in a contract. */
export function spelledValue(kind: Kind, raw: string): string | undefined {
  const tokens = raw.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z]+/g, " ").trim().split(" ").filter(Boolean);
  if (kind === "percent") {
    const end = tokens.findIndex((t, i) => t === "porcento" || t === "por" && tokens[i + 1] === "cento");
    if (end < 0) return undefined;
    const body = tokens.slice(0, end);
    const comma = body.indexOf("virgula");
    if (comma >= 0) {
      const whole = integerWords(body.slice(0, comma)), fraction = fractionWords(body.slice(comma + 1));
      return whole === undefined || fraction === undefined || fraction.length > 2 ? undefined : `${whole},${cents(fraction)}%`;
    }
    const unit = body.findIndex(t => /^(centesimos?|decimos?)$/.test(t));
    if (unit >= 0) {
      const integerEnd = body.findIndex(t => /^inteiros?$/.test(t));
      const whole = integerEnd >= 0 ? integerWords(body.slice(0, integerEnd)) : 0;
      const part = integerWords(body.slice(integerEnd + 1, unit));
      if (whole === undefined || part === undefined || unit !== body.length - 1) return undefined;
      const fraction = body[unit].startsWith("decimo") ? String(part * 10) : String(part).padStart(2, "0");
      return fraction.length > 2 ? undefined : `${whole},${fraction}%`;
    }
    const whole = integerWords(body);
    return whole === undefined ? undefined : `${whole},00%`;
  }
  if (kind === "money") {
    const words = tokens.filter(t => t !== "de");
    const reaisAt = words.findIndex(t => t === "real" || t === "reais"), centsAt = words.findIndex(t => /^centavos?$/.test(t));
    if (reaisAt < 0 && centsAt < 0) return undefined;
    const reais = reaisAt >= 0 ? integerWords(words.slice(0, reaisAt)) : 0;
    const centValue = centsAt >= 0 ? integerWords(words.slice(reaisAt + 1, centsAt)) : 0;
    if (reais === undefined || centValue === undefined || centValue > 99) return undefined;
    if (words.length !== (centsAt >= 0 ? centsAt + 1 : reaisAt + 1)) return undefined;
    return `${reais},${String(centValue).padStart(2, "0")}`;
  }
  const n = integerWords(tokens);
  return n === undefined ? undefined : String(n);
}

/** Spelled values written in parentheses right after the figure in the text ("11,84% (onze vírgula…)"). */
export function spelledNextTo(kind: Kind, text: string, figure: string) {
  const digits = figure.replace(/\D/g, "");
  if (!digits) return [];
  const pattern = new RegExp(`(?<!\\d)${[...digits].join("[.,\\s]?")}(?!\\d)\\s*%?\\s*\\(([^()]{3,160})\\)`, "g");
  const values = new Set<string>();
  for (const match of text.matchAll(pattern)) {
    const value = spelledValue(kind, match[1]);
    if (value) values.add(value);
  }
  return [...values];
}

// Digit pairs that OCR commonly confuses in scans and photos.
const confusable = new Set(["0-8", "0-6", "0-9", "1-7", "1-4", "3-8", "5-6", "5-8", "6-8", "8-9"]);
/** The two figures differ only by one commonly confused digit (11,84 read as 11,64). */
export function confusedDigit(found: string, expected: string) {
  const a = found.replace(/\D/g, ""), b = expected.replace(/\D/g, "");
  if (!a || a.length !== b.length) return undefined;
  const at = [...a].flatMap((digit, i) => digit === b[i] ? [] : [i]);
  if (at.length !== 1) return undefined;
  const pair = [a[at[0]], b[at[0]]].sort().join("-");
  return confusable.has(pair) ? { read: a[at[0]], requested: b[at[0]] } : undefined;
}

export type ReadingDoubt = { code: string; message: string; review: boolean };
/** Why a value that differs from the request may be a misreading, given the texts that supplied it.
 * `ocr` is true when no digital text of the document supplies the value. */
export function readingDoubt(key: string, found: string, expected: string, texts: string[], ocr: boolean): ReadingDoubt | undefined {
  const kind = kindOf(key);
  if (!kind || sameRequestedValue(key, found, expected)) return undefined;
  const spelled = [...new Set(texts.flatMap(text => spelledNextTo(kind, text, found)))];
  if (spelled.length === 1 && sameRequestedValue(key, spelled[0], expected)) {
    return ocr
      ? { code: "spelled_value_matches_request", review: true,
          message: `O número foi lido como ${found}, mas o valor por extenso no documento corresponde a ${expected}, igual ao pedido. Provável erro de leitura: confira o número no original antes de solicitar correção.` }
      : { code: "spelled_value_conflict", review: false,
          message: `O documento traz o número ${found}, mas o valor por extenso corresponde a ${expected}, igual ao pedido. O próprio documento está inconsistente: o número precisa ser corrigido.` };
  }
  // The words confirm the figure that was read: the divergence is real.
  if (spelled.some(value => sameRequestedValue(key, value, found))) return undefined;
  const digit = ocr ? confusedDigit(found, expected) : undefined;
  return digit
    ? { code: "ocr_digit_confusion", review: true,
        message: `O valor lido (${found}) difere do pedido (${expected}) só por um dígito que a leitura costuma confundir (${digit.read} no lugar de ${digit.requested}). Confira o dígito no original antes de solicitar correção.` }
    : undefined;
}
