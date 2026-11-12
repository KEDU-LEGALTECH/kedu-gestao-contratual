import { bankFields } from "./request-policy.js";

export const permissions: Record<string, string[]> = {
  Administrador: [
    "write",
    "schools",
    "confirm",
    "review",
    "commercial",
    "legal",
    "bank",
    "files",
    "sync",
    "settings",
    "export",
    "risk",
    "finance",
  ],
  Solicitante: ["write"],
  Operação: [
    "write",
    "schools",
    "confirm",
    "review",
    "bank",
    "files",
    "export",
  ],
  Jurídico: ["review", "legal", "bank", "files", "export"],
  Aprovador: ["commercial", "bank", "files", "export"],
  Consulta: [],
  Risco: [
    "write",
    "schools",
    "confirm",
    "review",
    "risk",
    "bank",
    "files",
    "export",
  ],
  Financeiro: ["finance", "bank", "files", "export", "review"],
};
export function permit(user: any, action: string) {
  if (!permissions[user.role]?.includes(action))
    throw Object.assign(Error("Seu perfil não tem permissão para esta ação."), {
      status: 403,
    });
}
export function access(user: any, demand: any) {
  if (user.role === "Solicitante" && demand.owner !== user.id)
    throw Object.assign(Error("Registro restrito ao responsável."), {
      status: 403,
    });
}
export function redactDemandData(user: { role: string }, data: Record<string, unknown>) {
  if (permissions[user.role]?.includes("bank")) return data;
  const visible = { ...data };
  for (const key of bankFields) {
    delete visible[key];
    delete visible["anterior" + key[0].toUpperCase() + key.slice(1)];
  }
  delete visible.contaTerceiro;
  return visible;
}
