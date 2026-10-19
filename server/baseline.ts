import { one } from "./db.js";
import { addendumFields, previousKey } from "../shared/request-policy.js";

export function baseline(demandId: string) {
  const row = one(
    "SELECT * FROM demand_baselines WHERE demand_id=? ORDER BY rowid DESC LIMIT 1",
    demandId,
  );
  return row
    ? { ...row, data: JSON.parse(row.payload), payload: undefined }
    : null;
}
export function generationData(d: any, subtype: string) {
  const data = JSON.parse(d.data);
  if (d.type === "Aditivo") {
    const current = baseline(d.id);
    if (!current || current.subtype !== subtype)
      throw Error(
        "Confirme os dados atuais do contrato matriz para este tipo de aditivo.",
      );
    for (const key of addendumFields[subtype] || [])
      data[previousKey(key)] = current.data[key] || "";
    data.referenciaAnterior = current.reference;
  }
  return data;
}
