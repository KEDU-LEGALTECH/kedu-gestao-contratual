import { sql } from "./db.js";
import { extractContractParties } from "./contract-parties.js";
import { validDocument } from "./reference-document.js";

const digitsOf = (value: string) => String(value || "").replace(/\D/g, "");
const own = (digits: string) => digits.startsWith("45543580");

/** Chooses the demand's organization from the documents already read, only to settle what the ticket left open:
 * one of several identifiers typed in the form, or a form value that lost its last digits. Never a guess:
 * exactly one identifier printed in the documents must match. */
export async function documentIdentifier(demandId: string, hash: string, candidates: string[], typedDigits: string) {
  if (!candidates.length && (typedDigits.length < 12 || typedDigits.length > 13)) return null;
  const found = new Map<string, { name: string; file: string }>();
  for (const file of await sql.all("SELECT name,extracted FROM processing_files WHERE demand_id=? AND ticket_hash=?", demandId, hash)) {
    let reading: any;
    try { reading = JSON.parse(file.extracted); } catch { continue; }
    if (reading.problem) continue;
    for (const party of extractContractParties(String(reading.text || ""))) {
      const digits = digitsOf(party.cnpj);
      if (validDocument(digits) && !own(digits)) found.set(digits, { name: party.name, file: file.name });
    }
    for (const value of reading.fields?.cnpj || []) {
      const digits = digitsOf(value);
      if (validDocument(digits) && !own(digits) && !found.has(digits)) found.set(digits, { name: "", file: file.name });
    }
  }
  const matches = [...found.keys()].filter((digits) => candidates.length ? candidates.includes(digits) : digits.startsWith(typedDigits));
  if (matches.length !== 1) return null;
  const match = found.get(matches[0])!;
  return { digits: matches[0], name: match.name, source: `documento "${match.file}"` };
}
