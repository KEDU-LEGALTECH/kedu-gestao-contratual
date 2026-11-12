import type { Express } from "express";
import multer from "multer";
import { z } from "zod";
import { all, one, run, db, id, now, localDate, audit, sql, auditAsync } from "./db.js";
import { permit, access } from "./workflow.js";
import { fileInfo } from "./governance-routes.js";
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
export function registerMatrixRoutes(app: Express) {
  app.post("/api/demands/:id/matrices", (req: any, _res, next) => {
    permit(req.user, "risk"); permit(req.user, "files"); permit(req.user, "bank"); next();
  }, upload.single("file"), async (req: any, res) => {
    const demand = await sql.one("SELECT * FROM demands WHERE id=?", req.params.id);
    if (!demand) throw Error("Demanda não encontrada.");
    access(req.user, demand);
    if (["Concluído", "Cancelado", "Em assinatura"].includes(demand.stage)) throw Error("Esta etapa não permite cadastrar matriz.");
    if (!demand.school_id) throw Error("Identifique primeiro a organização da demanda.");
    const b = z.object({ signatureDate: z.iso.date(), historyDate: z.iso.date(), source: z.enum(["Clicksign", "Clint"]), reference: z.string().trim().min(5).max(300), sequence: z.coerce.number().int().min(0).max(100000), attested: z.literal("true") }).parse(req.body);
    if (b.signatureDate > localDate() || b.historyDate > localDate()) throw Error("Datas de assinatura não podem estar no futuro.");
    if (b.historyDate < b.signatureDate) throw Error("A assinatura do último instrumento não pode ser anterior à matriz.");
    if (b.sequence === 0 && b.historyDate !== b.signatureDate) throw Error("Sem aditivos, informe a mesma data de assinatura da matriz no histórico.");
    const info = fileInfo(req.file);
    // Avoid silent duplicate matrices when the operator submits the same file again.
    if (await sql.one("SELECT f.contract_id FROM external_contract_files f JOIN contracts c ON c.id=f.contract_id WHERE c.school_id=? AND f.bytes=?", demand.school_id, req.file.buffer)) throw Error("Este arquivo já foi cadastrado para a organização. Selecione a matriz existente.");
    const cid = id();
    await sql.transaction(async () => {
      await sql.run("INSERT INTO contracts(id,school_id,status) VALUES(?,?,'Assinado')", cid, demand.school_id);
      await sql.run("INSERT INTO external_contract_files VALUES(?,?,?,?,?,?,?,?,?)", cid, info.name, info.mime, req.file.buffer, b.signatureDate, b.reference, req.user.id, now(), demand.id);
      for (const table of ["signed_history", "history_confirmations"]) await sql.run(`INSERT INTO ${table} VALUES(?,?,?,?,?,?,?,?)`, id(), cid, b.sequence, b.source, b.reference, b.historyDate, req.user.id, now());
      await auditAsync(demand.id, req.user.id, `Matriz externa cadastrada ${cid}; histórico ${b.sequence} declarado após consulta ${b.source}. Autenticidade da assinatura não verificada automaticamente. Referência: ${b.reference}`);
    });
    res.json({ id: cid });
  });
  app.get("/api/demands/:id/matrix/:contract/download", async (req: any, res) => {
    permit(req.user, "files"); permit(req.user, "bank");
    const d = await sql.one("SELECT * FROM demands WHERE id=?", req.params.id);
    if (!d) throw Error("Demanda não encontrada."); access(req.user, d);
    const f = await sql.one("SELECT f.*,c.school_id FROM external_contract_files f JOIN contracts c ON c.id=f.contract_id WHERE f.contract_id=?", req.params.contract);
    const own = await sql.one("SELECT parent_id FROM contracts WHERE id=?", d.contract_id);
    const linked = own?.parent_id || JSON.parse(d.data).matriz || d.contract_id;
    const pending = await sql.one("SELECT demand_id FROM glpi_intakes WHERE demand_id=? AND confirmed_at IS NULL", d.id);
    if (!f || f.school_id !== d.school_id || (linked !== f.contract_id && !pending)) throw Object.assign(Error("Matriz não vinculada à demanda."), { status: 404 });
    await auditAsync(d.id, req.user.id, "Download da matriz externa " + f.contract_id);
    res.setHeader("Cache-Control", "no-store"); res.type(f.mime).attachment(f.name).send(Buffer.from(f.bytes));
  });
}
