import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { z } from "zod";
import { bankFields } from "../shared/request-policy.js";
import { validateData } from "../shared/data-validation.js";
import { organizationAllowed } from "../shared/organization-policy.js";
import { access, permit } from "../shared/access-policy.js";
import { fields } from "./documents.js";
import { basisPoints, cents } from "./decimal.js";
import { allocatePostgresAddendum } from "./postgres-addendum.js";

export type PilotSql = postgres.Sql | postgres.TransactionSql;
export type PilotActor = { id: string; role: string };
const fail = (message: string, status = 400) => Object.assign(Error(message), { status });
const transaction = <T>(sql: PilotSql, fn: (tx: postgres.TransactionSql) => Promise<T>) =>
  "savepoint" in sql ? sql.savepoint(fn) : sql.begin(fn);
const createInput = z.object({
  school_id: z.string().min(1),
  type: z.enum(["Contrato de garantia", "Contrato educacional", "Contrato fornecedor", "Contrato marketing", "Aditivo"]),
  owner: z.string(),
  priority: z.enum(["Normal", "Alta", "Urgente"]),
  due: z.iso.date(),
  subtype: z.string().optional(),
  matrix: z.string().optional(),
}).strict().refine(input => input.type === "Aditivo"
  ? !!input.matrix && ["Conta bancária","Vigência","Percentual/data de repasse","Cashback","Taxa de remuneração"].includes(input.subtype || "")
  : !input.matrix);
const updateInput = z.record(z.string(), z.union([z.string().max(500), z.boolean()]));
const editable = new Set([...fields, "checklist", "contaTerceiro", "demandaDistrato", "demandaNovoContrato"]);
const dateFields = new Set(["inicio", "fim", "dataRepasse", "dataAssinaturaMatriz", "dataFormalizacao"]);
const rateFields = new Set(["remuneracao", "garantia", "repasse", "repasseSegundo", "cashback"]);

function reportDate() {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const date = new Date(day + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + (12 - date.getUTCDay()) % 7);
  return date.toISOString().slice(0, 10);
}

export async function createPostgresDemand(sql: PilotSql, actor: PilotActor, body: unknown) {
  permit(actor, "write");
  const input = createInput.parse(body);
  const owner = actor.role === "Solicitante" ? actor.id : input.owner;
  return transaction(sql, async tx => {
    const [school] = await tx`SELECT s.*,COALESCE(o.kind,'Escola') AS kind FROM schools s
      LEFT JOIN organization_classifications o ON o.school_id=s.id WHERE s.id=${input.school_id}`;
    if (!school || !organizationAllowed(input.type, school.kind)) throw fail("Organização incompatível com a demanda.");
    if (actor.role === "Solicitante") {
      const [owned] = await tx`SELECT 1 FROM demands WHERE school_id=${school.id} AND owner=${actor.id} LIMIT 1`;
      if (!owned) throw fail("Solicite à operação a vinculação da escola.", 403);
      if (input.matrix) {
        const [ownedMatrix] = await tx`SELECT id FROM demands WHERE contract_id=${input.matrix} AND owner=${actor.id} LIMIT 1`;
        if (!ownedMatrix) throw fail("Contrato matriz restrito às suas demandas.", 403);
      }
    }
    const [responsible] = await tx`SELECT 1 FROM users WHERE id=${owner}`;
    if (!responsible) throw fail("Responsável inválido.");
    const reservation = input.type === "Aditivo" ? await allocatePostgresAddendum(tx, school.id, input.matrix!) : null;
    const contract = reservation?.id ?? randomUUID();
    const id = "KD-" + randomUUID().slice(0,8).toUpperCase();
    const created = new Date().toISOString();
    const data = JSON.stringify({ cnpj: school.cnpj, razaoSocial: school.legal_name, endereco: school.address,
      matriz: input.matrix || contract, aditivo: reservation ? String(reservation.sequence) : "Não aplicável", checklist: false });
    const details = JSON.stringify({ subtype: input.subtype || "", reportDate: reportDate(), signers: [], legalFlags: [] });
    if (!reservation) await tx`INSERT INTO contracts(id,school_id) VALUES(${contract},${school.id})`;
    await tx`INSERT INTO demands(id,school_id,contract_id,type,stage,priority,owner,due,data,created)
      VALUES(${id},${school.id},${contract},${input.type},'Recebido',${input.priority},${owner},${input.due},${data},${created})`;
    await tx`INSERT INTO case_details(demand_id,payload) VALUES(${id},${details})`;
    await tx`INSERT INTO audit(id,demand_id,user_id,action,created) VALUES(${randomUUID()},${id},${actor.id},'Demanda criada manualmente',${created})`;
    return id;
  });
}

export async function updatePostgresDemand(sql: PilotSql, actor: PilotActor, id: string, body: Record<string,unknown>) {
  permit(actor, "write");
  const { expected_version, ...payload } = body;
  if (!Number.isSafeInteger(expected_version)) throw fail("Reabra a demanda para obter a versão atual.",409);
  const incoming = updateInput.parse(payload);
  return transaction(sql, async tx => {
    const [demand] = await tx`SELECT * FROM demands WHERE id=${id} FOR UPDATE`;
    if (!demand) throw fail("Demanda não encontrada.",404);
    access(actor,demand);
    if (Number(demand.data_version) !== expected_version) throw fail("Os dados foram alterados. Reabra a demanda.",409);
    if (["Concluído","Cancelado","Em assinatura"].includes(demand.stage)) throw fail("Esta etapa não permite alteração de dados.");
    const [intake] = await tx`SELECT 1 FROM glpi_intakes WHERE demand_id=${id} AND confirmed_at IS NULL`;
    if (intake) throw fail("Confira o recebimento GLPI antes de editar os dados comerciais.");
    const current = JSON.parse(demand.data);
    const data = { ...current, ...incoming };
    for (const [key,value] of Object.entries(incoming)) {
      if (!editable.has(key) || key.startsWith("anterior") || key === "referenciaAnterior") throw fail("Campo não autorizado.");
      if (["checklist","contaTerceiro"].includes(key) ? typeof value !== "boolean" : typeof value !== "string")
        throw fail("Formato de campo inválido.");
      if (["matriz","aditivo"].includes(key) && value !== current[key]) throw fail("Matriz e sequência são reservadas pelo sistema.");
      if (bankFields.includes(key) || key === "contaTerceiro") permit(actor,"bank");
      try {
        if (value && rateFields.has(key)) basisPoints(String(value));
        if (value && ["valor","cashbackValor"].includes(key)) cents(String(value));
      } catch (error) {
        if (error instanceof Error) throw fail(error.message);
        throw error;
      }
      if (value && dateFields.has(key) && !z.iso.date().safeParse(value).success) throw fail("Data inválida.");
    }
    const fieldErrors = validateData(data);
    if (Object.keys(fieldErrors).length) throw Object.assign(fail("Corrija os campos destacados antes de salvar."), { fields:fieldErrors });
    if (data.inicio && data.fim && data.inicio > data.fim) throw fail("Fim da vigência deve ser posterior ao início.");
    await tx`UPDATE demands SET data=${JSON.stringify(data)},data_version=data_version+1,confirmed=0,stage='Em elaboração' WHERE id=${id}`;
    if (data.cashbackValor) await tx`INSERT INTO cashback_values(demand_id,amount_cents) VALUES(${id},${cents(data.cashbackValor)})
      ON CONFLICT(demand_id) DO UPDATE SET amount_cents=excluded.amount_cents`;
    else await tx`DELETE FROM cashback_values WHERE demand_id=${id}`;
    if (["remuneracao","garantia","repasse","valor"].every(key=>data[key])) {
      await tx`INSERT INTO commercial_terms VALUES(${id},${basisPoints(data.remuneracao)},${basisPoints(data.garantia)},
        ${basisPoints(data.repasse)},${basisPoints(data.cashback || "0,00%")},${cents(data.valor)})
        ON CONFLICT(demand_id) DO UPDATE SET remuneration_bps=excluded.remuneration_bps,guarantee_bps=excluded.guarantee_bps,
          transfer_bps=excluded.transfer_bps,cashback_bps=excluded.cashback_bps,reference_cents=excluded.reference_cents`;
    }
    await tx`UPDATE approvals SET valid=0 WHERE document_id IN (SELECT id FROM documents WHERE demand_id=${id})`;
    await tx`INSERT INTO audit(id,demand_id,user_id,action,created) VALUES(${randomUUID()},${id},${actor.id},
      'Dados alterados; confirmação e aprovações invalidadas',${new Date().toISOString()})`;
  });
}
