/** Kind of legal request, as the legal team counts its monthly volume: new contracts, amendments,
 * advisory reviews and terminations. The GLPI category decides first (REVISÃO is always advisory work,
 * DESCREDENCIAMENTO always a termination); inside CONTRATOS the type identified by the portal decides. */
export const demandKinds = ["Contrato novo", "Aditivo", "Consultivo (revisão)", "Descredenciamento e distrato", "Outros", "A identificar"] as const;
export type DemandKind = (typeof demandKinds)[number];

/** Last level of the GLPI category, without the HTML escaping GLPI applies: "MeF advogados &#62; Juridico &#62; CONTRATOS" → "CONTRATOS". */
export function glpiCategoryName(raw: unknown): string {
  const text = String(raw ?? "").replace(/&#62;|&gt;/g, ">").replace(/&#60;|&lt;/g, "<").replace(/&amp;/g, "&").trim();
  return text.split(">").pop()!.trim() || "Sem categoria";
}

const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function demandKind(type: unknown, category: unknown): DemandKind {
  const t = plain(String(type ?? "")), c = plain(category == null || category === "" ? "" : glpiCategoryName(category));
  if (c.includes("descredenciamento") || /descredenciamento|distrato/.test(t)) return "Descredenciamento e distrato";
  if (c.includes("revisao")) return "Consultivo (revisão)";
  if (!t || t === "a classificar") return "A identificar";
  if (/aditivo|renovacao/.test(t)) return "Aditivo";
  if (/^contrato\b/.test(t)) return "Contrato novo";
  if (/analise/.test(t)) return "Consultivo (revisão)";
  return "Outros";
}

/** Counts in a fixed order; kinds and categories without demands in the period are left out. */
export function countBy<T extends string>(values: T[], order: readonly string[] = []) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  const rank = (k: string) => (order.includes(k) ? order.indexOf(k) : order.length);
  return [...counts].map(([name, count]) => ({ name, count }))
    .sort((a, b) => rank(a.name) - rank(b.name) || b.count - a.count || a.name.localeCompare(b.name, "pt-BR"));
}
