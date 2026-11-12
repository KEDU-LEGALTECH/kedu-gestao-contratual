import { randomUUID } from "node:crypto";
import type postgres from "postgres";

const conflict = (message: string, status = 409) => Object.assign(Error(message), { status });

/** Call inside the transaction that creates the demand and its audit event. */
export async function allocatePostgresAddendum(tx: postgres.TransactionSql, school: string, parent: string) {
  const [matrix] = await tx`SELECT id FROM contracts WHERE id=${parent} AND school_id=${school}
    AND status='Assinado' AND parent_id IS NULL FOR UPDATE`;
  if (!matrix) throw conflict("Aditivo exige contrato matriz assinado da mesma escola.", 400);
  const [registry] = await tx`SELECT id FROM contract_registry WHERE id=${parent} AND instrument_kind='Matriz'`;
  if (!registry) throw conflict("Aditivo exige contrato matriz assinado da mesma escola.", 400);
  const [history] = await tx`SELECT sequence,source FROM signed_history WHERE matrix_id=${parent} ORDER BY sequence DESC LIMIT 1`;
  if (!history) throw conflict("Confirme o último aditivo assinado no Clicksign/Clint antes de reservar a numeração.");
  if (history.source === "Registro local") {
    const [confirmed] = await tx`SELECT id FROM history_confirmations WHERE matrix_id=${parent} AND sequence=${history.sequence} LIMIT 1`;
    if (!confirmed) throw conflict("Consulte Clicksign/Clint e confirme o novo último assinado antes da próxima emissão.");
  }
  const sequence = Number(history.sequence) + 1;
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw conflict("Sequência do histórico inválida.");
  const id = randomUUID();
  const [reserved] = await tx`INSERT INTO contracts(id,school_id,parent_id,sequence)
    VALUES(${id},${school},${parent},${sequence}) ON CONFLICT(parent_id,sequence) DO NOTHING RETURNING id`;
  if (!reserved) throw conflict("O próximo número já está reservado. Conclua a reserva ou reconcilie o histórico assinado.");
  return { id, sequence };
}
