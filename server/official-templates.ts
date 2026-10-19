import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { one, all, run, id, now, audit } from "./db.js";
import { paragraphs } from "./documents.js";
import { structuredProfile, inspectStructured } from "./structured-docx.js";
import {
  deriveOfficial,
  homologationNotice,
  officialInputs,
  officialProblems,
  officialRequired,
  previewNotice,
} from "../shared/official-fields.js";

const dir = process.env.OFFICIAL_TEMPLATES_DIR || "templates/official";
export const sha256 = (bytes: Buffer | Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Registers the Canva adaptations listed in catalog.json as draft versions pending homologation.
 * Idempotent by file hash: an unchanged file never creates a new version; a changed file creates
 * a new draft and keeps every previous version (and its homologation) untouched. */
export function registerOfficialCatalog(path = join(dir, "catalog.json")) {
  if (!existsSync(path)) return { registered: 0, skipped: ["Catálogo oficial ausente: " + path] };
  const entries = JSON.parse(readFileSync(path, "utf8")) as any[];
  const skipped: string[] = [];
  let registered = 0;
  for (const entry of entries) {
    const file = join(dir, String(entry.file));
    if (!/^[\w.-]+\.docx$/.test(String(entry.file)) || !existsSync(file)) {
      skipped.push(entry.file + ": arquivo ausente");
      continue;
    }
    const bytes = readFileSync(file);
    const hash = sha256(bytes);
    if (hash !== entry.templateSha256) {
      skipped.push(entry.file + ": hash diferente do catálogo; regenere o catálogo antes de registrar");
      continue;
    }
    try {
      paragraphs(bytes);
      if (structuredProfile(bytes) !== entry.profile) throw Error("perfil divergente");
      inspectStructured(bytes);
    } catch (e: any) {
      skipped.push(entry.file + ": " + e.message);
      continue;
    }
    if (one("SELECT version_id FROM template_sources WHERE template_hash=?", hash)) continue;
    const templateId = "official-" + entry.profile;
    if (!one("SELECT id FROM templates WHERE id=?", templateId))
      run("INSERT INTO templates VALUES(?,?,?)", templateId, "OFICIAL (Canva) — " + entry.name, entry.type === "Aditivo" ? "Aditivo" : "Contrato");
    const version = one("SELECT COALESCE(MAX(version),0)+1 n FROM template_versions WHERE template_id=?", templateId).n;
    const versionId = id();
    run(
      "INSERT INTO template_versions VALUES(?,?,?,?,?,?,?)",
      versionId,
      templateId,
      version,
      "rascunho",
      paragraphs(bytes).join("\n"),
      bytes,
      null,
    );
    run("INSERT INTO template_catalog VALUES(?,?,?,?)", versionId, entry.type, entry.subtype || "", 0);
    run(
      "INSERT INTO template_sources VALUES(?,?,?,?,?,?,?)",
      versionId,
      entry.profile,
      entry.sourceUrl,
      entry.sourceSha256,
      hash,
      entry.modality || "",
      JSON.stringify(entry.slots),
    );
    audit(null, null, `Modelo oficial registrado como rascunho pendente de homologação: ${entry.name} v${version}`);
    registered++;
  }
  return { registered, skipped };
}

export function sourceOf(versionId: string) {
  return one("SELECT * FROM template_sources WHERE version_id=?", versionId);
}
/** A structured version is homologated only for the exact bytes reviewed by the legal team. */
export function homologated(version: any) {
  const source = sourceOf(version.id);
  if (!source) return false;
  const h = one("SELECT * FROM template_homologations WHERE version_id=?", version.id);
  return !!h && h.template_hash === sha256(Buffer.from(version.bytes)) && version.status === "aprovado";
}
export function matches(demand: any, details: any, version: any) {
  const catalog = one("SELECT * FROM template_catalog WHERE version_id=?", version.id);
  if (!catalog || catalog.document_type !== demand.type) return false;
  if (demand.type === "Aditivo") return catalog.subtype === details.subtype;
  const source = sourceOf(version.id);
  const data = JSON.parse(demand.data);
  return !source || !source.modality || source.modality === data.modalidade;
}
export function officialMissing(demand: any, subtype: string) {
  const data = JSON.parse(demand.data);
  const keys = officialRequired(demand.type, subtype, data.modalidade || "");
  return keys.filter((k) => typeof data[k] !== "string" || !data[k].trim());
}
export function officialPending(demand: any, subtype: string) {
  return officialProblems(demand.type, subtype, JSON.parse(demand.data));
}
/** Values for a structured template; preview marks gaps instead of inventing them. */
export function officialValues(
  demand: any,
  baseData: Record<string, any>,
  version: any,
  mode: "preview" | "document",
) {
  const contract = one("SELECT * FROM contracts WHERE id=?", demand.contract_id);
  const values = deriveOfficial(baseData, {
    sequence: contract?.parent_id ? contract.sequence : null,
    notice: mode === "document" ? "" : homologated(version) ? previewNotice : homologationNotice,
  });
  const slots: string[] = JSON.parse(sourceOf(version.id)?.slots || "[]");
  const gaps: string[] = [];
  for (const slot of slots) {
    if (slot === "avisoHomologacao" || slot === "pix") {
      values[slot] = values[slot] ?? "";
      continue;
    }
    if (!values[slot]?.trim()) {
      gaps.push(slot);
      if (mode === "preview") values[slot] = "⟨PENDENTE: " + (officialInputs[slot] || slot) + "⟩";
    }
  }
  return { values, gaps };
}
export function listOfficial() {
  return all(
    `SELECT v.id AS version_id,v.version,v.status,t.name,c.document_type,c.subtype,s.profile,s.source_url,s.modality,s.template_hash,
      h.created AS homologated_at,h.reference AS homologation_reference,u.name AS homologated_by,
      EXISTS(SELECT 1 FROM inactive_template_versions iv WHERE iv.version_id=v.id) AS inactive,
      (SELECT COUNT(*) FROM template_previews p WHERE p.template_version=v.id) AS previews
     FROM template_sources s JOIN template_versions v ON v.id=s.version_id JOIN templates t ON t.id=v.template_id
     JOIN template_catalog c ON c.version_id=v.id LEFT JOIN template_homologations h ON h.version_id=v.id
     LEFT JOIN users u ON u.id=h.user_id ORDER BY c.document_type,c.subtype,s.modality,v.version`,
  );
}
export function recordHomologation(versionId: string, userId: string, reference: string) {
  const version = one("SELECT * FROM template_versions WHERE id=?", versionId);
  if (!version || !sourceOf(versionId)) throw Error("Versão de modelo oficial não encontrada.");
  if (one("SELECT 1 FROM inactive_template_versions WHERE version_id=?", versionId))
    throw Error("Versão inativada não pode ser homologada.");
  if (one("SELECT 1 FROM template_homologations WHERE version_id=?", versionId))
    throw Error("Esta versão já foi homologada; a homologação é imutável.");
  if (!one("SELECT 1 FROM template_previews WHERE template_version=?", versionId))
    throw Error("Gere e confira ao menos uma prévia desta versão antes da homologação.");
  const hash = sha256(Buffer.from(version.bytes));
  if (hash !== sourceOf(versionId).template_hash) throw Error("O arquivo do modelo difere do registrado.");
  run("INSERT INTO template_homologations VALUES(?,?,?,?,?)", versionId, userId, reference, now(), hash);
  run("UPDATE template_versions SET status=?,approved_by=? WHERE id=? AND status=?", "aprovado", userId, versionId, "rascunho");
  audit(null, userId, "Modelo oficial homologado pelo Jurídico: " + reference);
}
