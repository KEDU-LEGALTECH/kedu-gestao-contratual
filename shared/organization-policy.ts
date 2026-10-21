export function organizationAllowed(type: string, kind: string) {
  if (kind === "Aguardando classificação") return false;
  if (kind === "Escola") return true;
  return ["Contrato fornecedor", "Contrato marketing"].includes(type) && ["Fornecedor", "Outra organização"].includes(kind);
}
