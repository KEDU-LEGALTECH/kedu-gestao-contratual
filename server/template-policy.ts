export function assertProductionTemplate(
  catalog: { demonstration?: number } | undefined,
) {
  if (catalog?.demonstration && process.env.NODE_ENV === "production")
    throw Error(
      "Modelos demonstrativos não podem ser usados em produção. Cadastre e aprove o modelo oficial.",
    );
}
