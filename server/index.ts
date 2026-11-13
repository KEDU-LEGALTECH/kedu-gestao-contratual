import {isOpenDemand,demandDisplayStage} from "../shared/glpi-ticket-meta.js";
import "dotenv/config";
import {acquireBackendInstance,backendVersion} from './backend-instance.js';
import { withReadCache } from "./sql.js";
import express from "express";
import { contractParagraphs } from "./attachment-analysis.js";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import multer from "multer";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { db, all, one, run, id, now, verify, audit, hash, localDate, sql, auditAsync, postgresMode } from "./db.js";
import "./seed.js";
import { fields, generate, review, paragraphs } from "./documents.js";
import {
  permissions,
  permit,
  access,
  required,
  latest,
  invalidate,
  transition,
  allocateAddendum,
  stages,
  saveTerms,
} from "./workflow.js";
import {
  syncGlpi,
  glpiStatus,
  listTickets,
  startSchedule,
} from "./glpi-sync.js";
import { basisPoints, cents } from "./decimal.js";
import { validateData } from "../shared/data-validation.js";
import { allowedOrigin } from "./origins.js";
import {
  bankFields,
  requiredFor,
  visibleFor,
} from "../shared/request-policy.js";
import { baseline, generationData } from "./baseline.js";
import {
  registerOfficialCatalog,
  officialValues,
  officialMissing,
  officialPending,
  homologated,
  matches,
  sourceOf,
  listOfficial,
  recordHomologation,
  sha256,
} from "./official-templates.js";
import { structuredProfile, inspectStructured } from "./structured-docx.js";
import { assertProductionTemplate } from "./template-policy.js";
import { importGlpiSchools } from "./glpi-schools.js";
import { downloadGlpiAttachment } from "./glpi-download.js";
import { organizations, classifyOrganization } from "./organizations.js";
import { organizationAllowed } from "../shared/organization-policy.js";
import { intakeForDemand, confirmGlpiIntake } from "./glpi-intake.js";
import { registerMatrixRoutes } from "./matrix-registration.js";
import { attachmentChecks, registerAttachmentRoutes } from "./attachment-routes.js";
import { scheduleContractProcessing,processingSummary,processingSummaries,receivedDocumentTypesAll } from "./contract-processing.js";
import { processingView,registerProcessingRoutes } from "./processing-routes.js";
import { fieldLabels as officialInputs } from "../shared/official-fields.js";
import { officialVisible } from "../shared/request-policy.js";
import { startBackups } from "./backup-service.js";
import {
  registerGovernance,
  seedCatalog,
  fileInfo,
} from "./governance-routes.js";
import {
  details,
  saveDetails,
  requirements,
  humanMissing,
  documentTypes,
  matrixCases,
  nextReport,
  legalReport,
  evidenceLabels,
  subtypes,
} from "./governance.js";
if(process.env.NODE_ENV!=='test')acquireBackendInstance();
await seedCatalog();
const officialCatalog = await registerOfficialCatalog();
for (const message of officialCatalog.skipped)
  console.warn("Modelo oficial não registrado: " + message);
await startSchedule();
if(process.env.NODE_ENV!=='test') {
  // Retry unavailable originals even when nobody has the portal open.
  const attachmentRecovery=setInterval(()=>{scheduleContractProcessing().catch(error=>console.error('Recuperação de anexos falhou:',error));},60000);
  attachmentRecovery.unref();
}
const app = express();
if(process.env.TRUST_PROXY_HOPS==="1")app.set("trust proxy",1);
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
// On PostgreSQL, repeated reads within one GET request share a cache (see server/sql.ts).
app.use((req, res, next) => {
  if (req.method !== "GET") return next();
  const store = { entries: new Map(), open: true };
  res.on("close", () => { store.open = false; store.entries.clear(); });
  withReadCache(next, store);
});
// Supabase keeps PostgreSQL backups; the local job copies the SQLite file only.
if(!postgresMode)startBackups();
app.get("/healthz",async (_req,res)=>{res.set("Cache-Control","no-store");res.set('X-Kedu-Build',backendVersion.build);try{await sql.one("SELECT 1");res.json({status:"ok"});}catch{res.status(503).json({status:"unavailable"});}});
app.use("/api", (req, res, next) => {
  if (
    !["GET", "HEAD"].includes(req.method) &&
    req.headers.origin &&
    !allowedOrigin(req.headers.origin)
  )
    return res.status(403).json({
      error:
        "Endereço de acesso não autorizado. Em desenvolvimento, abra pelo localhost ou 127.0.0.1. Para um domínio próprio, configure ALLOWED_ORIGINS no servidor.",
    });
  next();
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});
const signedUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
});
app.post(
  "/api/login",
  rateLimit({ windowMs: 900000, limit: 20 }),
  async (req, res) => {
    const u = await sql.one("SELECT * FROM users WHERE email=?", String(req.body.email));
    if (
      process.env.NODE_ENV === "production" &&
      u?.email.endsWith("@demo.kedu.local")
    )
      return res.status(401).json({ error: "E-mail ou senha inválidos." });
    if (!u || !verify(String(req.body.password), u.password))
      return res.status(401).json({ error: "E-mail ou senha inválidos." });
    const token = randomBytes(32).toString("hex");
    await sql.run("INSERT INTO sessions VALUES(?,?,?)", token, u.id, Date.now() + 8 * 3600000);
    res.cookie("session", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      maxAge: 8 * 3600000,
    });
    res.json({
      id: u.id,
      name: u.name,
      role: u.role,
      permissions: permissions[u.role],
    });
  },
);
app.use("/api", async (req: any, res, next) => {
  const u = await sql.one("SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires>?", req.cookies.session || "", Date.now());
  if (!u)
    return res
      .status(401)
      .json({ error: "Entre na sua conta para continuar." });
  req.user = u;
  next();
});
app.post("/api/logout", async (req, res) => {
  await sql.run("DELETE FROM sessions WHERE token=?", req.cookies.session || "");
  res.clearCookie("session");
  res.json({ ok: true });
});
app.get("/api/me", (req: any, res) =>
  res.json({
    id: req.user.id,
    name: req.user.name,
    role: req.user.role,
    permissions: permissions[req.user.role],
  }),
);
registerGovernance(app);
registerMatrixRoutes(app);
registerAttachmentRoutes(app);
registerProcessingRoutes(app);
async function demand(req: any) {
  const d = await sql.one("SELECT * FROM demands WHERE id=?", req.params.id);
  if (!d)
    throw Object.assign(Error("Demanda não encontrada."), { status: 404 });
  access(req.user, d);
  return d;
}
function safeData(user: any, data: any) {
  if (!permissions[user.role].includes("bank"))
    for (const f of [
      ...bankFields,
      ...bankFields.map(
        (key) => "anterior" + key[0].toUpperCase() + key.slice(1),
      ),
      "contaTerceiro",
    ])
      delete data[f];
  return data;
}
app.get("/api/bootstrap", async (req: any, res) => {
  await scheduleContractProcessing();
  const where = req.user.role === "Solicitante" ? " WHERE d.owner=?" : "";
  // A fixed number of queries for the whole list: per-demand lookups are slow on a remote database.
  // Independent reads for the whole list, fetched together (each one is a round trip on a remote database).
  const [documentTypes, summaries, checkRows, demandRows, registry, closureRows, contracts, users, templates, sync, settings, triage] = await Promise.all([
    receivedDocumentTypesAll(),
    processingSummaries(),
    sql.all("SELECT c.demand_id,c.status,c.data_version,c.ticket_hash FROM attachment_checks c WHERE c.rowid=(SELECT MAX(x.rowid) FROM attachment_checks x WHERE x.demand_id=c.demand_id AND x.document_id=c.document_id)"),
    sql.all(`SELECT d.*,COALESCE(s.name,json_extract(d.data,'$.razaoSocial'),'Organização a identificar') AS school,s.cnpj,COALESCE(u.name,'Não atribuído') AS owner_name,t.external_id AS glpi_ticket,t.status AS glpi_status,json_extract(t.payload,'$.priority') AS glpi_priority,t.hash AS glpi_hash FROM demands d LEFT JOIN schools s ON s.id=d.school_id LEFT JOIN users u ON u.id=d.owner LEFT JOIN glpi_tickets t ON t.external_id=d.glpi_id${where} ORDER BY d.created DESC,d.rowid`, ...(where ? [req.user.id] : [])),
    organizations(req.user.role === "Solicitante" ? req.user.id : undefined),
    sql.all("SELECT demand_id,payload FROM case_details"),
    sql.all("SELECT c.*,s.name AS school FROM contract_registry c JOIN schools s ON s.id=c.school_id" +
        (req.user.role === "Solicitante"
          ? " WHERE EXISTS(SELECT 1 FROM demands d WHERE d.contract_id=c.id AND d.owner=?)"
          : ""), ...(req.user.role === "Solicitante" ? [req.user.id] : [])),
    req.user.role === "Solicitante"
        ? sql.all("SELECT id,name,role,email FROM users WHERE id=?", req.user.id)
        : sql.all("SELECT id,name,role,email FROM users"),
    sql.all("SELECT t.*,c.document_type,c.subtype,c.demonstration,EXISTS(SELECT 1 FROM template_sources ts WHERE ts.version_id=v.id) AS official,v.id AS version_id,v.version,CASE WHEN EXISTS(SELECT 1 FROM inactive_template_versions iv WHERE iv.version_id=v.id) THEN 'inativo' ELSE v.status END AS status FROM templates t JOIN template_versions v ON v.template_id=t.id LEFT JOIN template_catalog c ON c.version_id=v.id"),
    sql.all("SELECT * FROM sync_logs ORDER BY created DESC LIMIT 20"),
    sql.all("SELECT * FROM settings WHERE key IN ('legalPolicies','glpiMapping')"),
    sql.one("SELECT COUNT(*) n FROM glpi_tickets WHERE demand_id IS NULL OR state LIKE 'alterado%'"),
  ]);
  const latestChecks = new Map<string, any[]>();
  for (const c of checkRows) {
    const list = latestChecks.get(c.demand_id);
    if (list) list.push(c); else latestChecks.set(c.demand_id, [c]);
  }
  const demands: any[] = [];
  for (const { glpi_ticket, glpi_status, glpi_priority, glpi_hash, ...d } of demandRows) {
    const checks = latestChecks.get(d.id) || [];
    const check = checks.find(c=>c.status==="divergente") || checks.find(c=>c.status==="inconclusiva") || checks[0];
    demands.push({ ...d, receivedDocumentTypes:documentTypes.get(d.id) || [],glpiOrigin:glpi_ticket == null ? null : {status:glpi_status,priority:glpi_priority}, processing:summaries.get(d.id) ?? null,data: safeData(req.user, JSON.parse(d.data)), documentCheck: check ? {status:check.status,stale:checks.some(c=>c.data_version!==d.data_version || c.ticket_hash!==glpi_hash)} : null });
  }


  const open = demands.filter(isOpenDemand);
  const completed = demands.filter(
    (d) =>
      d.stage === "Concluído" &&
      d.completed &&
      localDate(d.completed).slice(0, 7) === localDate().slice(0, 7),
  );
  const closures = new Map(closureRows.map(r => [r.demand_id, r.payload]));
  res.json({
    demands,
    schools: registry.filter(s => s.organization_kind === "Escola"),
    organizations: registry,
    contracts,
    users,
    templates,
    sync,
    settings,
    glpi: { mode: process.env.GLPI_MODE === "real" ? "real" : "demo" },
    metrics: {
      glpiTriage: triage.n,
      glpiClosure: demands.filter(
        (d) =>
          d.stage === "Concluído" &&
          !JSON.parse(closures.get(d.id) || "{}").glpiClosure,
      ).length,
      open: open.length,
      overdue: open.filter((d) => d.due && d.due < localDate()).length,
      approval: demands.filter((d) => d.stage === "Em aprovação").length,
      signature: demands.filter((d) => d.stage === "Em assinatura").length,
      completed: completed.length,
      average: completed.length
        ? Math.round(
            completed.reduce(
              (s, d) =>
                s +
                (Date.parse(d.completed) - Date.parse(d.created)) / 86400000,
              0,
            ) / completed.length,
          )
        : 0,
    },
  });
});
const schoolSchema = z.object({
  name: z.string().min(3),
  legal_name: z.string().min(3),
  cnpj: z.string().regex(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/),
  address: z.string().max(500),
  contact: z.string().max(200),
});
app.post("/api/schools", async (req: any, res) => {
  permit(req.user, "schools");
  const data = schoolSchema.parse(req.body);
  const sid = id();
  await sql.run("INSERT INTO schools VALUES(?,?,?,?,?,?)", sid, data.name, data.legal_name, data.cnpj, data.address, data.contact);
  await auditAsync(null, req.user.id, "Escola criada");
  res.json({ id: sid });
});
app.put("/api/schools/:id", async (req: any, res) => {
  permit(req.user, "schools");
  const data = schoolSchema.parse(req.body);
  const active = await sql.one("SELECT id FROM demands WHERE school_id=? AND stage NOT IN (?,?)", req.params.id, "Concluído", "Cancelado");
  if (active)
    throw Error(
      "Há demandas abertas: conclua ou cancele antes de alterar os dados cadastrais da escola.",
    );
  await sql.run("UPDATE schools SET name=?,legal_name=?,cnpj=?,address=?,contact=? WHERE id=?", data.name, data.legal_name, data.cnpj, data.address, data.contact, req.params.id);
  await auditAsync(null, req.user.id, "Escola atualizada");
  await sql.run("UPDATE school_glpi_origins SET reviewed_at=?,reviewed_by=? WHERE school_id=?", now(), req.user.id, req.params.id);
  res.json({ ok: true });
});
app.get("/api/schools/:id", async (req: any, res) => {
  if (
    req.user.role === "Solicitante" &&
    !await sql.one("SELECT id FROM demands WHERE school_id=? AND owner=?", req.params.id, req.user.id)
  )
    throw Object.assign(Error("Escola restrita às suas demandas."), {
      status: 403,
    });
  res.json({
    school: await sql.one("SELECT * FROM schools WHERE id=?", req.params.id),
    representatives: await sql.all("SELECT * FROM representatives WHERE school_id=?", req.params.id),
  });
});
app.post("/api/schools/:id/representatives", async (req: any, res) => {
  permit(req.user, "schools");
  const data = z
    .object({ name: z.string().min(3), email: z.email() })
    .parse(req.body);
  await sql.run("INSERT INTO representatives VALUES(?,?,?,?)", id(), req.params.id, data.name, data.email);
  res.json({ ok: true });
});
const demandSchema = z.object({
  school_id: z.string(),
  type: z.enum(documentTypes as [string, ...string[]]),
  glpi_id: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,80}$/)
    .optional(),
  subtype: z.string().optional(),
  owner: z.string(),
  priority: z.enum(["Normal", "Alta", "Urgente"]),
  due: z.iso.date(),
  matrix: z.string().optional(),
});
type Imported = {
  data: Record<string, string>;
  origins: Record<string, string>;
  ticket: string;
};
/** Shared by manual creation and creation from an imported GLPI ticket. */
async function createDemand(user: any, body: unknown, imported?: Imported) {
  const b = demandSchema.parse(body),
    s = await sql.one("SELECT * FROM schools WHERE id=?", b.school_id);
  if (b.type === "Aditivo" && !subtypes.includes(b.subtype || ""))
    throw Error(
      "Selecione o tipo específico de aditivo antes de criar a demanda.",
    );
  if (!s) throw Error("Escola inválida.");
  const kind = (await sql.one("SELECT kind FROM organization_classifications WHERE school_id=?", s.id))?.kind || "Escola";
  if (!organizationAllowed(b.type, kind))
    throw Error(kind === "Aguardando classificação" ? "Classifique a organização antes de criar a demanda." : "A categoria da organização não é compatível com esse tipo de demanda.");
  if (
    user.role === "Solicitante" &&
    !await sql.one("SELECT id FROM demands WHERE school_id=? AND owner=?", s.id, user.id)
  )
    throw Object.assign(
      Error(
        "Solicite à operação a vinculação da escola antes de criar uma demanda.",
      ),
      { status: 403 },
    );
  if (
    user.role === "Solicitante" &&
    b.matrix &&
    !await sql.one("SELECT id FROM demands WHERE contract_id=? AND owner=?", b.matrix, user.id)
  )
    throw Object.assign(Error("Contrato matriz restrito às suas demandas."), {
      status: 403,
    });
  if (
    matrixCases.includes(b.type) &&
    !await sql.one("SELECT id FROM contract_registry WHERE id=? AND school_id=? AND instrument_kind='Matriz' AND (status='Assinado' OR (?='Migração de modalidade' AND status='Distratado'))", b.matrix || "", s.id, b.type)
  )
    throw Error(
      "Esta operação jurídica exige vínculo com contrato matriz assinado da escola.",
    );
  if (
    !await sql.one("SELECT id FROM users WHERE id=?", user.role === "Solicitante" ? user.id : b.owner)
  )
    throw Error("Responsável inválido.");
  if (b.glpi_id && await sql.one("SELECT id FROM demands WHERE glpi_id=?", b.glpi_id))
    throw Error("O chamado GLPI já está vinculado a uma demanda.");
  if (
    b.matrix &&
    !await sql.one("SELECT id FROM contract_registry WHERE id=? AND school_id=? AND instrument_kind='Matriz'", b.matrix, s.id)
  )
    throw Error("O contrato matriz deve pertencer à escola selecionada.");
  return await sql.transaction(async () => {
    let cid = id(),
      seq;
    if (b.type === "Aditivo") {
      const c = await allocateAddendum(s.id, b.matrix || "", false);
      cid = c.id;
      seq = c.sequence;
    } else await sql.run("INSERT INTO contracts(id,school_id) VALUES(?,?)", cid, s.id);
    const did = "KD-" + id().slice(0, 8).toUpperCase();
    await sql.run("INSERT INTO demands(id,school_id,contract_id,type,stage,priority,owner,due,data,created) VALUES(?,?,?,?,?,?,?,?,?,?)", did, s.id, cid, b.type, "Recebido", b.priority, user.role === "Solicitante" ? user.id : b.owner, b.due, JSON.stringify({
        ...(imported?.data || {}),
        cnpj: s.cnpj,
        razaoSocial: s.legal_name,
        endereco: s.address,
        matriz: b.matrix || cid,
        aditivo: seq ? String(seq) : "Não aplicável",
        checklist: false,
      }), now());
    await auditAsync(did, user.id, imported
        ? `Demanda criada a partir do chamado GLPI #${imported.ticket} importado (somente leitura); dados conferidos por pessoa`
        : "Demanda criada manualmente");
    if (b.glpi_id)
      await sql.run("UPDATE demands SET glpi_id=? WHERE id=?", b.glpi_id, did);
    await saveDetails(did, {
      subtype: b.subtype || "",
      reportDate: nextReport(),
      signers: [],
      legalFlags: [],
      ...(imported ? { origins: imported.origins } : {}),
    });
    if (imported)
      await sql.run("UPDATE glpi_tickets SET demand_id=?,state='vinculado' WHERE external_id=? AND demand_id IS NULL", did, imported.ticket);
    return did;
  });
}
app.post("/api/demands", async (req: any, res) => {
  permit(req.user, "write");
  res.json({ id: await createDemand(req.user, req.body) });
});
app.get("/api/demands/:id", async (req: any, res) => {
  const d = await demand(req);
  // Independent reads fetched together.
  const [docs, reviewRows, caseDetails, officialList] = await Promise.all([
    sql.all("SELECT id,version,template_version,data_version,created,signed IS NOT NULL AS is_signed FROM documents WHERE demand_id=? ORDER BY version DESC", d.id),
    sql.all("SELECT r.* FROM reviews r JOIN documents doc ON doc.id=r.document_id WHERE doc.demand_id=? ORDER BY r.created DESC", d.id),
    details(d),
    listOfficial(),
  ]);
  const reviews = reviewRows.map((r) => ({
    ...r,
    results: JSON.parse(r.results).map((v: any) =>
      permissions[req.user.role].includes("bank")
        ? v
        : [
              ...bankFields,
              ...bankFields.map(
                (key) => "anterior" + key[0].toUpperCase() + key.slice(1),
              ),
            ].includes(v.field)
          ? { ...v, expected: "Restrito", found: "Restrito" }
          : v,
    ),
  }));
  const officialTemplates: any[] = [];
  for (const t of officialList)
    if (!t.inactive && await matches(d, caseDetails, { id: t.version_id })) officialTemplates.push({ ...t, homologated: !!t.homologated_at });
  // processingView may record the current status; the remaining parts only read and are fetched together.
  const processing = permissions[req.user.role].includes("files") && permissions[req.user.role].includes("bank") ? await processingView(d.id) : await processingSummary(d.id);
  const currentDetails = await details(d);
  const [checks, glpiIntake, previews, baselineData, missing, requirementList, documentBundle, approvals, glpiTicket, history] = await Promise.all([
    attachmentChecks(d,req.user),
    (async () => {
      const intake = await intakeForDemand(d.id);
      if (!intake || permissions[req.user.role].includes("bank")) return intake;
      return { ...intake, text: "Conteúdo restrito ao perfil autorizado.", conversation: [], documents: [], analysis: { suggestion: intake.analysis.suggestion, pendencies: ["Conferência por pessoa autorizada pendente"] } };
    })(),
    sql.all("SELECT p.id,p.template_version,p.data_version,p.created,u.name AS author FROM template_previews p JOIN users u ON u.id=p.author WHERE p.demand_id=? ORDER BY p.created DESC", d.id),
    (async () => {
      const b = await baseline(d.id);
      return b ? { ...b, data: safeData(req.user, b.data) } : null;
    })(),
    required(d),
    requirements(d),
    (async () => {
      if (!permissions[req.user.role].includes("files") || !permissions[req.user.role].includes("bank")) return null;
      const contract = await sql.one("SELECT * FROM contracts WHERE id=?", d.contract_id);
      const matrixId = contract?.parent_id || JSON.parse(d.data).matriz || d.contract_id;
      return {
        matrixId,
        externalMatrix: matrixId ? await sql.one("SELECT contract_id,name,signature_date,reference FROM external_contract_files WHERE contract_id=?", matrixId) || null : null,
        signed: matrixId ? await sql.all("SELECT doc.id,doc.version,doc.created,origin.id AS demand_id,c.id AS contract_id,c.parent_id,c.sequence FROM documents doc JOIN demands origin ON origin.id=doc.demand_id JOIN contracts c ON c.id=origin.contract_id WHERE doc.signed IS NOT NULL AND (c.id=? OR c.parent_id=?) AND (? <> 'Solicitante' OR origin.owner=?) ORDER BY c.sequence,doc.version DESC", matrixId, matrixId, req.user.role, req.user.id) : [],
        evidence: await sql.all("SELECT id,kind,name,verified_at FROM evidence_files WHERE demand_id=? ORDER BY created DESC", d.id),
      };
    })(),
    sql.all("SELECT a.*,u.name FROM approvals a JOIN documents d ON d.id=a.document_id JOIN users u ON u.id=a.user_id WHERE d.demand_id=?", d.id),
    d.glpi_id
      ? sql.one("SELECT external_id,state,mode,changed_at FROM glpi_tickets WHERE external_id=? AND demand_id=?", d.glpi_id, d.id).then(row => row || null)
      : null,
    sql.all("SELECT a.*,u.name FROM audit a LEFT JOIN users u ON u.id=a.user_id WHERE demand_id=? ORDER BY created DESC", d.id),
  ]);
  res.json({
    ...d,
    processing,
    attachmentChecks: checks,
    glpiIntake,
    data: safeData(req.user, JSON.parse(d.data)),
    subtype: currentDetails.subtype || "",
    requiredFields: requiredFor(
      d.type,
      currentDetails.subtype,
      JSON.parse(d.data).modalidade,
    ),
    visibleFields: visibleFor(
      d.type,
      currentDetails.subtype,
      JSON.parse(d.data).modalidade,
    ),
    officialFields: officialVisible(
      d.type,
      currentDetails.subtype,
      JSON.parse(d.data).modalidade,
    ),
    official: {
      missing: officialMissing(d, currentDetails.subtype),
      problems: officialPending(d, currentDetails.subtype),
      templates: officialTemplates,
      previews,
    },
    baseline: baselineData,
    missing,
    requirements: requirementList,
    documents: docs,
    documentBundle,
    evidenceLabels,
    reviews,
    approvals,
    origins: currentDetails.origins || {},
    glpiClosure: currentDetails.glpiClosure || null,
    glpiTicket,
    history,
  });
});
const percent = /^(?:\d{1,2}|100),\d{2}%$/;
app.put("/api/demands/:id/data", async (req: any, res) => {
  permit(req.user, "write");
  const d = await demand(req);
  if (await sql.one("SELECT demand_id FROM glpi_intakes WHERE demand_id=? AND confirmed_at IS NULL", d.id)) throw Error("Confira o recebimento GLPI antes de editar os dados comerciais.");
  if (["Concluído", "Cancelado", "Em assinatura"].includes(d.stage))
    throw Error("Esta etapa não permite alteração de dados.");
  const { expected_version, ...payload } = req.body;
  if (
    !Number.isInteger(expected_version) ||
    expected_version !== d.data_version
  )
    return res.status(409).json({
      error:
        "Os dados foram alterados ou a versão não foi informada. Reabra a demanda e revise antes de salvar.",
    });
  const incoming = z
    .record(z.string(), z.union([z.string().max(500), z.boolean()]))
    .parse(payload);
  const existing = JSON.parse(d.data);
  const fieldErrors = validateData({ ...existing, ...incoming });
  if (Object.keys(fieldErrors).length)
    return res.status(400).json({
      error: "Corrija os campos destacados antes de salvar.",
      fields: fieldErrors,
    });
  for (const [key, value] of Object.entries(incoming)) {
    if (
      ![
        ...fields,
        "checklist",
        "contaTerceiro",
        "demandaDistrato",
        "demandaNovoContrato",
      ].includes(key) ||
      key.startsWith("anterior") ||
      key === "referenciaAnterior"
    )
      throw Error("Campo não autorizado.");
    if (
      !["checklist", "contaTerceiro"].includes(key) &&
      typeof value !== "string"
    )
      throw Error("O campo deve conter texto: " + key);
    if (
      ["checklist", "contaTerceiro"].includes(key) &&
      typeof value !== "boolean"
    )
      throw Error("Confirmação documental inválida.");
    if (["matriz", "aditivo"].includes(key) && value !== existing[key])
      throw Error(
        "Matriz e sequência são reservadas pelo sistema e não podem ser alteradas.",
      );
    if ([...bankFields, "contaTerceiro"].includes(key))
      permit(req.user, "bank");
    if (
      [
        "remuneracao",
        "garantia",
        "repasse",
        "repasseSegundo",
        "cashback",
      ].includes(key) &&
      value &&
      !percent.test(String(value))
    )
      throw Error("Percentual inválido. Use 7,70% (de 0 a 100).");
    if (
      [
        "remuneracao",
        "garantia",
        "repasse",
        "repasseSegundo",
        "cashback",
      ].includes(key) &&
      value
    )
      basisPoints(String(value));
    if (key === "valor" && value) cents(String(value));
    if (
      [
        "inicio",
        "fim",
        "dataRepasse",
        "dataAssinaturaMatriz",
        "dataFormalizacao",
      ].includes(key) &&
      value &&
      !z.iso.date().safeParse(value).success
    )
      throw Error("Data inválida.");
    existing[key] = value;
  }
  if (existing.inicio && existing.fim && existing.inicio > existing.fim)
    throw Error("Fim da vigência deve ser posterior ao início.");
  await sql.transaction(async () => {
    const updated = await sql.run("UPDATE demands SET data=?,data_version=data_version+1,confirmed=0,stage=? WHERE id=? AND data_version=?", JSON.stringify(existing), "Em elaboração", d.id, expected_version);
    if (!updated.changes)
      throw Object.assign(
        Error("Conflito de edição: reabra a demanda e revise os dados."),
        { status: 409 },
      );
    await saveTerms(d.id, existing);
    await invalidate(d.id);
    await auditAsync(d.id, req.user.id, "Dados alterados; confirmação e aprovações invalidadas");
  });
  res.json({ ok: true });
});
app.put("/api/demands/:id/intake", async (req: any, res) => {
  const d = await demand(req);
  const body = z.object({ expected_version: z.number().int(), expected_hash: z.string(), school_id: z.string().min(1), organization_kind: z.enum(["Escola","Fornecedor","Outra organização"]).optional(), type: z.enum(documentTypes as [string,...string[]]), subtype: z.string().optional(), matrix: z.string().optional(), owner: z.string(), priority: z.enum(["Normal","Alta","Urgente"]), due: z.iso.date(), note: z.string().trim().min(10).max(500), attested: z.literal(true) }).parse(req.body);
  await confirmGlpiIntake(req.user, d, body);
  res.json({ ok: true });
});
app.post("/api/demands/:id/confirm", async (req: any, res) => {
  permit(req.user, "confirm");
  const d = await demand(req);
  if ((await required(d)).length)
    throw Error("Preencha os campos e confirme a documentação obrigatória.");
  await sql.run("UPDATE demands SET confirmed=1 WHERE id=?", d.id);
  await auditAsync(d.id, req.user.id, "Dados críticos confirmados por pessoa responsável");
  res.json({ ok: true });
});
app.post("/api/demands/:id/stage", async (req: any, res) => {
  const d = await demand(req);
  await transition(req.user, d, String(req.body.stage), req.body.reason);
  res.json({ ok: true });
});
app.post("/api/demands/:id/generate", async (req: any, res) => {
  permit(req.user, "write");
  permit(req.user, "bank");
  const d = await demand(req);
  if (!d.confirmed || (await required(d)).length)
    throw Error("Confirme os dados completos antes da geração.");
  if (!["Em elaboração", "Em conferência"].includes(d.stage))
    throw Error("Geração disponível em elaboração ou conferência.");
  const t = await sql.one("SELECT * FROM template_versions WHERE id=? AND id NOT IN (SELECT version_id FROM inactive_template_versions)", req.body.template_version || "tv1");
  if (t && await sourceOf(t.id) && !await homologated(t))
    throw Error(
      "Modelo oficial pendente de homologação jurídica: gere uma prévia para conferência. A prévia não pode seguir para assinatura.",
    );
  if (!t || t.status !== "aprovado")
    throw Error("Selecione uma versão aprovada.");
  const catalog = await sql.one("SELECT * FROM template_catalog WHERE version_id=?", t.id);
  assertProductionTemplate(catalog);
  if (!catalog || !await matches(d, await details(d), t))
    throw Error(
      "O modelo não corresponde ao tipo/subtipo/modalidade desta demanda. Cadastre e aprove a versão correta.",
    );
  const base = await generationData(d, (await details(d)).subtype);
  let snapshot: Record<string, string> = base;
  if (await sourceOf(t.id)) {
    if (!await homologated(t))
      throw Error(
        "Modelo oficial pendente de homologação jurídica: gere uma prévia para conferência. A prévia não pode seguir para assinatura.",
      );
    const problems = officialPending(d, (await details(d)).subtype);
    if (problems.length)
      throw Error("Corrija antes de gerar: " + problems.join("; ") + ".");
    const official = await officialValues(d, base, t, "document");
    if (official.gaps.length)
      throw Error(
        "Dados obrigatórios do modelo ausentes: " +
          official.gaps.map((k) => officialInputs[k] || k).join(", ") +
          ".",
      );
    snapshot = official.values;
  }
  const bytes = generate(Buffer.from(t.bytes), snapshot);
  const docid = id();
  const version = ((await latest(d.id))?.version || 0) + 1;
  await invalidate(d.id);
  await sql.run("INSERT INTO documents VALUES(?,?,?,?,?,?,?,?,?,?)", docid, d.id, version, t.id, d.data_version, JSON.stringify(snapshot), bytes, null, req.user.id, now());
  await sql.run("UPDATE demands SET stage=? WHERE id=?", "Em conferência", d.id);
  await auditAsync(d.id, req.user.id, `Minuta v${version} gerada com modelo v${t.version}`);
  res.json({ id: docid });
});
async function uploadSnapshot(d: any, template: any) {
  const base =
    d.type === "Aditivo" && (await baseline(d.id))?.subtype === (await details(d)).subtype
      ? await generationData(d, (await details(d)).subtype)
      : JSON.parse(d.data);
  return JSON.stringify(
    await sourceOf(template.id)
      ? (await officialValues(d, base, template, "document")).values
      : base,
  );
}
function checkedFile(req: any) {
  if (!req.file || !req.file.originalname.toLowerCase().endsWith(".docx"))
    throw Error("Envie um arquivo DOCX de até 5 MB.");
  paragraphs(req.file.buffer);
  return req.file.buffer;
}
app.post("/api/demands/:id/upload", upload.single("file"), async (req: any, res) => {
  permit(req.user, "files");
  permit(req.user, "write");
  const d = await demand(req),
    previous = await latest(d.id);
  if (await sql.one("SELECT demand_id FROM glpi_intakes WHERE demand_id=? AND confirmed_at IS NULL", d.id)) throw Error("Confira o recebimento GLPI antes de anexar a minuta.");
  if (
    ![
      "Recebido",
      "Em elaboração",
      "Em conferência",
      "Em aprovação",
      "Devolvido",
    ].includes(d.stage)
  )
    throw Error("Gere uma minuta e envie a revisão antes da assinatura.");
  const bytes = checkedFile(req);
  if (!d.glpi_id)
    throw Error("Registre a referência GLPI antes de anexar a minuta.");
  const selected = previous?.template_version || req.body.template_version;
  const template = await sql.one("SELECT v.*,c.document_type,c.subtype,c.demonstration FROM template_versions v JOIN template_catalog c ON c.version_id=v.id WHERE v.id=? AND v.status=? AND v.id NOT IN(SELECT version_id FROM inactive_template_versions)", selected, "aprovado");
  if (!template || !await matches(d, await details(d), template))
    throw Error("Selecione um modelo aprovado correspondente ao documento.");
  assertProductionTemplate(template);
  if (await sourceOf(template.id) && !await homologated(template))
    throw Error("Modelo oficial pendente de homologação jurídica.");
  if (paragraphs(bytes).some((p) => /NÃO UTILIZAR PARA ASSINATURA/.test(p)))
    throw Error(
      "O arquivo é uma prévia ou minuta de homologação e não pode ser usado como minuta para assinatura.",
    );
  await invalidate(d.id);
  await sql.run("INSERT INTO documents VALUES(?,?,?,?,?,?,?,?,?,?)", id(), d.id, (previous?.version || 0) + 1, template.id, d.data_version, await uploadSnapshot(d, template), bytes, null, req.user.id, now());
  await sql.run("UPDATE demands SET stage=? WHERE id=?", "Em conferência", d.id);
  await auditAsync(d.id, req.user.id, "Nova versão DOCX anexada; aprovações invalidadas");
  res.json({ ok: true });
});
app.post("/api/demands/:id/review", async (req: any, res) => {
  permit(req.user, "review");
  const d = await demand(req),
    doc = await latest(d.id);
  if (["Concluído", "Cancelado"].includes(d.stage))
    throw Error("Demanda encerrada não permite nova conferência.");
  if (!doc || doc.data_version !== d.data_version)
    throw Error("Gere a minuta atual.");
  const template = await sql.one("SELECT * FROM template_versions WHERE id=?", doc.template_version);
  const r = review(
    Buffer.from(doc.bytes),
    JSON.parse(doc.snapshot),
    Buffer.from(template.bytes),
  );
  await sql.run("INSERT INTO reviews VALUES(?,?,?,?,?,?)", id(), doc.id, r.status, JSON.stringify(r.results), req.user.id, now());
  await auditAsync(d.id, req.user.id, "Conferência: " + r.status);
  if (r.results.some((f: any) => f.field === "Corpo fixo")) {
    const g = await details(d);
    await saveDetails(d.id, {
      ...g,
      systemLegalFlags: Array.from(
        new Set([...(g.systemLegalFlags || []), "Alteração do corpo fixo"]),
      ),
    });
    await auditAsync(d.id, req.user.id, "Controle jurídico obrigatório por alteração estrutural do corpo fixo");
  }
  if (r.status !== "conforme") {
    await invalidate(d.id);
    await sql.run("UPDATE demands SET stage=? WHERE id=?", "Devolvido", d.id);
    await auditAsync(d.id, req.user.id, "Devolução automática: conferência " + r.status);
  }
  res.json(r);
});
app.post("/api/demands/:id/approve", async (req: any, res) => {
  const kind = z
    .enum(["Comercial", "Jurídica", "Risco", "Financeiro"])
    .parse(req.body.kind);
  permit(
    req.user,
    (
      {
        Comercial: "commercial",
        Jurídica: "legal",
        Risco: "risk",
        Financeiro: "finance",
      } as Record<string, string>
    )[kind],
  );
  const d = await demand(req),
    doc = await latest(d.id);
  if (
    d.stage !== "Em aprovação" ||
    !doc ||
    !d.confirmed ||
    doc.data_version !== d.data_version ||
    (await required(d)).length
  )
    throw Error("A demanda não está pronta para aprovação.");
  const r = await sql.one("SELECT * FROM reviews WHERE document_id=? ORDER BY created DESC LIMIT 1", doc.id);
  if (r?.status !== "conforme")
    throw Error("Conferência conforme obrigatória.");
  if ((await humanMissing(doc)).length)
    throw Error("Complete os cinco eixos da revisão humana.");
  const deadline = (await requirements(d)).reviewDeadline;
  if (
    deadline &&
    deadline < localDate() &&
    (!req.body.delayReason || String(req.body.delayReason).trim().length < 10)
  )
    throw Error(
      "Prazo da quinta-feira ultrapassado. Registre justificativa de atraso com pelo menos 10 caracteres.",
    );
  await sql.run("INSERT INTO approvals VALUES(?,?,?,?,?,?,?)", id(), doc.id, d.data_version, kind, req.user.id, now(), 1);
  await auditAsync(d.id, req.user.id, "Aprovação " + kind + " da minuta v" + doc.version);
  if (deadline && deadline < localDate())
    await auditAsync(d.id, req.user.id, "Validação fora do prazo semanal: " + String(req.body.delayReason));
  res.json({ ok: true });
});
app.post(
  "/api/demands/:id/signature",
  signedUpload.single("file"),
  async (req: any, res) => {
    permit(req.user, "files");
    permit(req.user, "write");
    const d = await demand(req),
      doc = await latest(d.id);
    if (d.stage !== "Em assinatura" || !doc)
      throw Error("Envie para assinatura após as aprovações.");
    assertProductionTemplate(
      await sql.one("SELECT demonstration FROM template_catalog WHERE version_id=?", doc.template_version),
    );
    if (doc.signed)
      throw Error(
        "Documento assinado já registrado. Não é permitido substituir silenciosamente.",
      );
    if (req.body.attested !== "true")
      throw Error(
        "Confirme que o arquivo corresponde à versão aprovada e contém as assinaturas exigidas.",
      );
    const info = fileInfo(req.file);
    const bytes = req.file.buffer;
    if ((await required(d)).length || (await humanMissing(doc)).length)
      throw Error("Requisitos/revisão humana pendentes.");
    const lastReview = await sql.one("SELECT status FROM reviews WHERE document_id=? ORDER BY created DESC,rowid DESC LIMIT 1", doc.id);
    if (lastReview?.status !== "conforme")
      throw Error(
        "Conferência divergente ou inconclusiva da versão atual impede o registro da assinatura.",
      );
    for (const kind of (await requirements(d)).approvals)
      if (
        !await sql.one("SELECT id FROM approvals WHERE document_id=? AND data_version=? AND kind=? AND valid=1", doc.id, d.data_version, kind)
      )
        throw Error("Validação pendente: " + kind);
    await sql.run("INSERT INTO signature_records VALUES(?,?,?,?,?,?)", doc.id, info.mime, info.name, req.user.id, now(), 1);
    await sql.run("UPDATE documents SET signed=? WHERE id=?", bytes, doc.id);
    await auditAsync(d.id, req.user.id, "Documento assinado registrado manualmente; autenticidade não verificada");
    res.json({ ok: true });
  },
);
app.get("/api/documents/:id/download", async (req: any, res) => {
  permit(req.user, "files");
  permit(req.user, "bank");
  const doc = await sql.one("SELECT * FROM documents WHERE id=?", req.params.id);
  if (!doc) throw Error("Documento não encontrado.");
  access(req.user, await sql.one("SELECT * FROM demands WHERE id=?", doc.demand_id));
  const bytes = req.query.signed === "1" ? doc.signed : doc.bytes;
  if (!bytes) throw Error("Documento assinado não registrado.");
  await auditAsync(doc.demand_id, req.user.id, "Download autorizado de documento");
  const info =
    req.query.signed === "1"
      ? await sql.one("SELECT * FROM signature_records WHERE document_id=?", doc.id)
      : null;
  res
    .type(
      info?.mime ||
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    .attachment(info?.name || `kedu-${doc.id}.docx`)
    .send(Buffer.from(bytes));
});
app.post("/api/templates", upload.single("file"), async (req: any, res) => {
  permit(req.user, "settings");
  const bytes = checkedFile(req);
  const text = paragraphs(bytes).join("\n");
  const structured = structuredProfile(bytes) ? inspectStructured(bytes) : null;
  if (!structured)
    for (const m of text.matchAll(/\{([^}]+)\}/g))
      if (!fields.includes(m[1]))
        throw Error("Variável não autorizada: " + m[1]);
  const tid = req.body.template_id || id();
  const documentType = z
    .enum(documentTypes as [string, ...string[]])
    .parse(req.body.document_type || "Contrato de garantia");
  const subtype = req.body.subtype || "";
  if (
    documentType === "Aditivo" &&
    ![
      "Conta bancária",
      "Vigência",
      "Percentual/data de repasse",
      "Cashback",
      "Taxa de remuneração",
    ].includes(subtype)
  )
    throw Error("Selecione o tipo específico de aditivo.");
  if (!req.body.template_id)
    await sql.run("INSERT INTO templates VALUES(?,?,?)", tid, z.string().min(3).parse(req.body.name), "Contrato");
  const version = (await sql.one("SELECT COALESCE(MAX(version),0)+1 n FROM template_versions WHERE template_id=?", tid)).n;
  const versionId = id();
  await sql.run("INSERT INTO template_versions VALUES(?,?,?,?,?,?,?)", versionId, tid, version, "rascunho", text, bytes, null);
  await sql.run("INSERT INTO template_catalog VALUES(?,?,?,?)", versionId, documentType, subtype, structured || req.body.demonstration === "false" ? 0 : 1);
  if (structured) {
    const modality = z
      .enum(["", "Garantia Completa", "Garantia Conjunta", "Garantia Prevista"])
      .parse(req.body.modality || "");
    await sql.run("INSERT INTO template_sources VALUES(?,?,?,?,?,?,?)", versionId, structured.profile, z
        .string()
        .max(300)
        .parse(req.body.source_url || "Envio manual"), "", sha256(bytes), modality, JSON.stringify(structured.slots));
  }
  await auditAsync(null, req.user.id, structured
      ? "Modelo estruturado cadastrado como rascunho; exige prévia e homologação jurídica"
      : "Modelo DOCX cadastrado como rascunho");
  res.json({ ok: true });
});
app.get("/api/templates/:id/view", async (req:any,res) => {
  permit(req.user,"files");
  const t=await sql.one("SELECT v.*,t.name FROM template_versions v JOIN templates t ON t.id=v.template_id WHERE v.id=?", req.params.id);
  if(!t?.bytes)throw Error("Modelo não encontrado.");
  res.setHeader("Cache-Control","no-store");
  res.json({name:t.name,version:t.version,status:t.status,paragraphs:contractParagraphs(Buffer.from(t.bytes))});
});
app.get("/api/templates/:id/editable", async (req:any,res) => {
  permit(req.user,"files");
  const t=await sql.one("SELECT v.*,s.source_url,t.name FROM template_versions v JOIN template_sources s ON s.version_id=v.id JOIN templates t ON t.id=v.template_id WHERE v.id=?", req.params.id);
  if(!t || !t.bytes)throw Error("Modelo editável não encontrado.");
  await auditAsync(null, req.user.id, "Download do modelo editável para revisão: "+t.name+" v"+t.version);
  res.setHeader("Cache-Control","no-store");
  res.type("application/vnd.openxmlformats-officedocument.wordprocessingml.document").attachment("MODELO-REVISAO-"+t.name.replace(/[^\p{L}\p{N} -]/gu,"_")+"-v"+t.version+".docx").send(Buffer.from(t.bytes));
});
app.get("/api/templates/official", async (_req: any, res) =>
  res.json(await listOfficial()),
);
app.post("/api/templates/:id/homologate", async (req: any, res) => {
  permit(req.user, "legal");
  const b = z
    .object({
      reference: z.string().trim().min(10).max(300),
      attested: z.literal(true),
    })
    .parse(req.body);
  await recordHomologation(req.params.id, req.user.id, b.reference);
  res.json({ ok: true });
});
app.post("/api/demands/:id/preview", async (req: any, res) => {
  permit(req.user, "write");
  permit(req.user, "bank");
  const d = await demand(req);
  const t = await sql.one("SELECT * FROM template_versions WHERE id=? AND id NOT IN (SELECT version_id FROM inactive_template_versions)", String(req.body.template_version || ""));
  if (!t || !await sourceOf(t.id))
    throw Error("Selecione um modelo oficial estruturado.");
  if (!await matches(d, await details(d), t))
    throw Error(
      "O modelo não corresponde ao tipo/subtipo/modalidade desta demanda.",
    );
  let base: Record<string, any>;
  try {
    base = await generationData(d, (await details(d)).subtype);
  } catch {
    base = JSON.parse(d.data);
  }
  const { values, gaps } = await officialValues(d, base, t, "preview");
  const bytes = generate(Buffer.from(t.bytes), values);
  const previewId = id();
  await sql.run("INSERT INTO template_previews VALUES(?,?,?,?,?,?,?,?)", previewId, d.id, t.id, d.data_version, JSON.stringify(values), bytes, req.user.id, now());
  await auditAsync(d.id, req.user.id, `Prévia gerada com modelo oficial v${t.version} (${await homologated(t) ? "homologado" : "pendente de homologação"}); não liberada para assinatura`);
  res.json({
    id: previewId,
    gaps: gaps.map((k) => officialInputs[k] || k),
    problems: officialPending(d, (await details(d)).subtype),
  });
});
app.get("/api/previews/:id/download", async (req: any, res) => {
  permit(req.user, "files");
  permit(req.user, "bank");
  const p = await sql.one("SELECT * FROM template_previews WHERE id=?", req.params.id);
  if (!p) throw Error("Prévia não encontrada.");
  access(req.user, await sql.one("SELECT * FROM demands WHERE id=?", p.demand_id));
  await auditAsync(p.demand_id, req.user.id, "Download de prévia (não utilizável para assinatura)");
  res
    .type(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    .attachment(`PREVIA-NAO-ASSINAR-${p.demand_id}.docx`)
    .send(Buffer.from(p.bytes));
});
app.post("/api/templates/:id/approve", async (req: any, res) => {
  permit(req.user, "legal");
  if (await sourceOf(req.params.id))
    throw Error(
      "Modelos oficiais estruturados são liberados somente pela homologação jurídica, após prévia.",
    );
  await sql.run("UPDATE template_versions SET status=?,approved_by=? WHERE id=? AND status=?", "aprovado", req.user.id, req.params.id, "rascunho");
  await auditAsync(null, req.user.id, "Versão de modelo aprovada");
  res.json({ ok: true });
});
app.post("/api/templates/:id/deactivate", async (req: any, res) => {
  permit(req.user, "settings");
  if (!await sql.one("SELECT id FROM template_versions WHERE id=?", req.params.id))
    throw Error("Modelo não encontrado.");
  await sql.run("INSERT OR IGNORE INTO inactive_template_versions VALUES(?,?,?)", req.params.id, req.user.id, now());
  await auditAsync(null, req.user.id, "Versão de modelo inativada sem alterar seu conteúdo");
  res.json({ ok: true });
});
app.post("/api/settings", async (req: any, res) => {
  permit(req.user, "settings");
  const b = z
    .object({
      key: z.enum(["glpiMapping", "legalPolicies"]),
      value: z.string().max(3000),
    })
    .parse(req.body);
  const config = JSON.parse(b.value);
  if (b.key === "legalPolicies") {
    z.array(z.string().min(3).max(150)).max(30).parse(config);
    if (
      (await sql.one("SELECT value FROM settings WHERE key=?", b.key))?.value !== b.value
    ) {
      await sql.run("UPDATE approvals SET valid=0 WHERE document_id IN(SELECT doc.id FROM documents doc JOIN demands d ON d.id=doc.demand_id WHERE d.stage NOT IN('Concluído','Cancelado'))");
      await sql.run("UPDATE demands SET confirmed=0,data_version=data_version+1,stage='Em elaboração' WHERE stage NOT IN('Concluído','Cancelado')");
      await auditAsync(null, req.user.id, "Política jurídica alterada; demandas abertas exigem reconfirmação e nova versão");
    }
  }
  await sql.run("INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", b.key, b.value);
  await auditAsync(null, req.user.id, "Configuração atualizada: " + b.key);
  res.json({ ok: true });
});
app.post("/api/users", async (req: any, res) => {
  permit(req.user, "settings");
  const b = z
    .object({
      name: z.string().min(3),
      email: z.email(),
      role: z.enum([
        "Administrador",
        "Solicitante",
        "Operação",
        "Jurídico",
        "Aprovador",
        "Consulta",
        "Risco",
        "Financeiro",
      ]),
      password: z.string().min(12),
    })
    .parse(req.body);
  await sql.run("INSERT INTO users VALUES(?,?,?,?,?)", id(), b.name, b.email, b.role, hash(b.password));
  await auditAsync(null, req.user.id, "Usuário cadastrado");
  res.json({ ok: true });
});
app.put("/api/users/:id/role", async (req: any, res) => {
  permit(req.user, "settings");
  const role = z
    .enum([
      "Administrador",
      "Solicitante",
      "Operação",
      "Jurídico",
      "Aprovador",
      "Consulta",
      "Risco",
      "Financeiro",
    ])
    .parse(req.body.role);
  const u = await sql.one("SELECT * FROM users WHERE id=?", req.params.id);
  if (!u) throw Error("Usuário não encontrado.");
  if (u.id === req.user.id)
    throw Error("Peça a outro administrador para alterar seu perfil.");
  if (
    u.role === "Administrador" &&
    role !== "Administrador" &&
    (await sql.one("SELECT COUNT(*) n FROM users WHERE role=?", "Administrador")).n <= 1
  )
    throw Error("É necessário manter um administrador.");
  await sql.run("UPDATE users SET role=? WHERE id=?", role, u.id);
  await sql.run("DELETE FROM sessions WHERE user_id=?", u.id);
  await auditAsync(null, req.user.id, "Perfil de usuário atualizado; sessões revogadas");
  res.json({ ok: true });
});
app.get("/api/glpi/status", (req: any, res) => {
  permit(req.user, "sync");
  res.json(glpiStatus());
});
app.post("/api/glpi/schools/import", async (req: any, res) => {
  permit(req.user, "schools");
  res.json(await importGlpiSchools(req.user.id));
});
app.put("/api/organizations/:id/classification", async (req: any, res) => {
  permit(req.user, "schools");
  const body = z.object({ kind: z.enum(["Escola", "Fornecedor", "Outra organização"]), expected_version: z.number().int().min(1), note: z.string().trim().min(10).max(500), attested: z.literal(true) }).parse(req.body);
  await classifyOrganization(req.params.id, body.kind, body.expected_version, body.note, req.user.id);
  res.json({ ok: true });
});
app.post("/api/sync", async (req: any, res) => {
  permit(req.user, "sync");
  const summary = await syncGlpi(req.user.id);
  res.json({ imported: summary.created, ...summary });
});
app.get("/api/glpi/tickets", async (req: any, res) => {
  permit(req.user, "confirm");
  res.json(await listTickets());
});
app.get("/api/glpi/tickets/:id/documents/:document/download", rateLimit({ windowMs: 60000, limit: 10 }), async (req: any, res) => {
  permit(req.user, "files");
  permit(req.user, "bank");
  const controller = new AbortController();
  res.on("close", () => { if (!res.writableEnded) controller.abort(); });
  const file = await downloadGlpiAttachment(req.params.id, req.params.document, AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]));
  await auditAsync(null, req.user.id, `Download de anexo GLPI #${req.params.id}, documento ${req.params.document}; somente leitura`);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.attachment(file.name).type(file.mime).send(file.bytes);
});
app.post("/api/glpi/tickets/:id/demand", async (req: any, res) => {
  permit(req.user, "write");
  permit(req.user, "confirm");
  const ticket = await sql.one("SELECT * FROM glpi_tickets WHERE external_id=?", req.params.id);
  if (!ticket) throw Error("Chamado importado não encontrado.");
  if (ticket.demand_id)
    throw Error(
      "Este chamado já está vinculado à demanda " + ticket.demand_id + ".",
    );
  const b = z
    .object({ attested: z.literal(true) })
    .passthrough()
    .parse(req.body);
  const analysis = (await listTickets()).find(
    (t: any) => t.external_id === ticket.external_id,
  )!.analysis;
  // Only the narrative is carried over; identification comes from the school registry and
  // every date, value and sequence must be confirmed by a person in the demand.
  const motivo = [
    analysis.fields.motivo?.value,
    analysis.fields.observacoes?.value,
  ]
    .filter(Boolean)
    .join(" — ");
  const data: Record<string, string> = motivo
    ? { motivo: motivo.slice(0, 500) }
    : {};
  const origins: Record<string, string> = motivo
    ? {
        motivo: analysis.fields.motivo?.origin || "GLPI #" + ticket.external_id,
      }
    : {};
  origins.cnpj = origins.razaoSocial =
    "Cadastro da escola (confrontado com o CNPJ do chamado)";
  const did = await createDemand(
    req.user,
    { ...b, glpi_id: ticket.external_id },
    { data, origins, ticket: ticket.external_id },
  );
  await auditAsync(did, req.user.id, "Pendências identificadas na importação: " +
      analysis.pendencies.join(" | ").slice(0, 900));
  res.json({ id: did });
});
app.post("/api/glpi/tickets/:id/acknowledge", async (req: any, res) => {
  permit(req.user, "confirm");
  const ticket = await sql.one("SELECT * FROM glpi_tickets WHERE external_id=?", req.params.id);
  if (!ticket || !ticket.state.startsWith("alterado"))
    throw Error("Não há alteração externa pendente.");
  z.object({ note: z.string().trim().min(5).max(300) }).parse(req.body);
  await sql.run("UPDATE glpi_tickets SET state=? WHERE external_id=?", ticket.demand_id ? "vinculado" : "novo", ticket.external_id);
  await auditAsync(ticket.demand_id, req.user.id, `Alteração externa do chamado GLPI #${ticket.external_id} revisada: ${String(req.body.note).trim()}`);
  res.json({ ok: true });
});
export function csvCell(v: unknown) {
  let s = String(v ?? "");
  if (/^[\s]*[=+@\-\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
async function reportRows(req: any) {
  const from = req.query.from
      ? z.iso.date().parse(req.query.from)
      : "2000-01-01",
    to = req.query.to ? z.iso.date().parse(req.query.to) : "2100-12-31";
  if (from > to) throw Error("O início do período deve ser anterior ao fim.");
  const rows: any[] = [], summaries = await processingSummaries();
  for (const d of await sql.all("SELECT d.id,d.created,d.completed,d.due,d.owner,d.stage,d.type,COALESCE(s.name,json_extract(d.data,'$.razaoSocial'),'Organização a identificar') AS school,COALESCE(u.name,'Não atribuído') AS owner_name,(SELECT t.status FROM glpi_tickets t WHERE t.external_id=d.glpi_id) AS glpi_status FROM demands d LEFT JOIN schools s ON s.id=d.school_id LEFT JOIN users u ON u.id=d.owner ORDER BY d.rowid")) {const glpiOrigin=d.glpi_status?{status:d.glpi_status}:null;rows.push({...d,workflow_stage:d.stage,glpiOrigin,stage:demandDisplayStage({stage:d.stage,glpiOrigin,processing:summaries.get(d.id) ?? null})});}
  return rows.filter(
    (d) =>
      localDate(d.created) >= from &&
      localDate(d.created) <= to &&
      (!req.query.owner || d.owner === req.query.owner) &&
      (req.user.role !== "Solicitante" || d.owner === req.user.id),
  );
}
app.get("/api/reports", async (req: any, res) => {
  const rows = await reportRows(req),
    completed = rows.filter((d) => d.completed),
    divergences: any[] = [],
    closedPendencies: any[] = [],
    summaries = await processingSummaries();
  for (const d of rows) {
    const processing=summaries.get(d.id) ?? null;
    if(processing && !["Concluído","Cancelado","Em assinatura"].includes(d.workflow_stage)){
      if(["Aguardando análise","Conferência parcial","Aguardando correção"].includes(processing.status))(isOpenDemand(d)?divergences:closedPendencies).push({id:d.id,school:d.school,status:processing.status,count:processing.issues||0,glpiStage:d.stage});
      continue;
    }
    const doc = await latest(d.id);
    if (!doc) continue;
    const r = await sql.one("SELECT * FROM reviews WHERE document_id=? ORDER BY created DESC LIMIT 1", doc.id);
    if (r && r.status !== "conforme")
      divergences.push({
        id: d.id,
        school: d.school,
        status: r.status,
        count: JSON.parse(r.results).length,
      });
  }
  res.json({
    volume: rows.length,
    overdue: rows.filter(
      (d) => isOpenDemand(d) && !!d.due && d.due < localDate(),
    ).length,
    average: completed.length
      ? Math.round(
          completed.reduce(
            (s, d) =>
              s + (Date.parse(d.completed) - Date.parse(d.created)) / 86400000,
            0,
          ) / completed.length,
        )
      : 0,
    byOwner: (await sql.all("SELECT id,name FROM users")).map((u) => ({
      name: u.name,
      count: rows.filter((d) => d.owner === u.id).length,
    })),
    byStage: [...new Set([...stages,...rows.map(d=>d.stage)])].map((stage) => ({
      stage,
      count: rows.filter((d) => d.stage === stage).length,
    })),
    divergences,
    closedPendencies,
  });
});
app.get("/api/reports.csv", async (req: any, res) => {
  permit(req.user, "export");
  const rows = await reportRows(req);
  res
    .type("text/csv; charset=utf-8")
    .attachment("relatorio-kedu.csv")
    .send(
      "\uFEFF" +
        [
          ["Demanda", "Escola", "Etapa", "Tipo", "Prazo", "Responsável"],
          ...rows.map((r) => [
            r.id,
            r.school,
            r.stage,
            r.type,
            r.due,
            r.owner_name,
          ]),
        ]
          .map((r) => r.map(csvCell).join(";"))
          .join("\r\n"),
    );
});
app.use(express.static("dist"));
app.use((err: any, _req: any, res: any, _next: any) => {
  // PostgreSQL errors never reach the user verbatim; constraint and trigger refusals are expected.
  const postgres = err?.name === "PostgresError";
  if (postgres && !/^(23|P0001)/.test(err.code)) console.error("Erro do banco:", err.code, err.message);
  res.status(err.status || 400).json({
    error:
      err instanceof z.ZodError
        ? "Dados inválidos: " +
          err.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")
        : err.code?.startsWith("SQLITE") || postgres
          ? "Operação não permitida pelas restrições do banco."
          : err.message || "Não foi possível concluir a operação.",
  });
});
if (process.env.NODE_ENV !== "test")
  app.listen(
    Number(process.env.PORT || 3001),
    process.env.HOST || "127.0.0.1",
    () =>
      console.log(
        `Kedu API: http://${process.env.HOST || "127.0.0.1"}:${process.env.PORT || 3001}`,
      ),
  );
export default app;
