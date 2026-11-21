import { sql, now, auditAsync } from "./db.js";
import { access, permit, permissions } from "../shared/access-policy.js";

/** How a demand ended outside the portal workflow. */
export const finalOutcomes = ["Resolvido no GLPI", "Resolvido fora do portal", "Encerrado sem necessidade de contrato"];
// Kept in settings so a mistaken finalization can be undone without a schema change.
const key = (id: string) => "demandFinalization:" + id;

export async function finalization(id: string) {
  const row = await sql.one("SELECT value FROM settings WHERE key=?", key(id));
  return row ? JSON.parse(row.value) : null;
}

/** Ends a demand already resolved elsewhere (usually in GLPI). The reason is mandatory and audited. */
export async function finalizeDemand(user: any, d: any, outcome: string, reason: string) {
  if (!["write", "legal"].some(action => permissions[user.role]?.includes(action)))
    throw Object.assign(Error("Seu perfil não tem permissão para esta ação."), { status: 403 });
  access(user, d);
  if (["Concluído", "Cancelado"].includes(d.stage)) throw Error("A demanda já está encerrada.");
  if (!finalOutcomes.includes(outcome)) throw Error("Escolha como a demanda foi resolvida.");
  const note = String(reason || "").trim().slice(0, 1000);
  if (note.length < 5) throw Error("Informe o motivo da finalização.");
  await sql.transaction(async () => {
    await sql.run("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", key(d.id),
      JSON.stringify({ previous: d.stage, outcome, reason: note, by: user.name || user.email || user.id, at: now() }));
    await sql.run("UPDATE demands SET stage='Concluído' WHERE id=?", d.id);
    await auditAsync(d.id, user.id, `Demanda finalizada manualmente (${outcome}): ${note}`);
  });
}

/** Undoes a manual finalization (administrators only), restoring the previous stage. */
export async function reopenDemand(user: any, d: any) {
  permit(user, "settings");
  const saved = await finalization(d.id);
  if (!saved || d.stage !== "Concluído") throw Error("Só uma demanda finalizada manualmente pode ser reaberta.");
  await sql.transaction(async () => {
    await sql.run("UPDATE demands SET stage=? WHERE id=?", saved.previous, d.id);
    await sql.run("DELETE FROM settings WHERE key=?", key(d.id));
    await auditAsync(d.id, user.id, `Demanda reaberta; volta para ${saved.previous}. Finalização desfeita: ${saved.outcome}`);
  });
}
