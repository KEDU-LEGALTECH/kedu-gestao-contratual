import { pendingReason } from "./pending-reason.js";

/** What to do next in each area of a demand whose contract could not be compared yet. */
export const contractStageActions: Record<string, string> = {
  "Aguardando elaboração do contrato": "Elabore o contrato com os documentos enviados no chamado.",
  "Consulta ao GLPI incompleta": "Confira os anexos e as aprovações na conversa do GLPI. Se a integração não tiver acesso, solicite a permissão de leitura.",
  "Contrato não encontrado": "Confira a conversa do chamado. Se o contrato ainda não foi enviado, solicite o instrumento para conferência.",
  "Contrato não lido": "Abra a demanda para ver se falta baixar o contrato ou concluir a leitura do arquivo.",
};

export type ReportItem = { kind: "erro" | "pendencia" | "aviso"; title: string; detail: string; source?: string; action?: string };
export type DemandReport = { situation: string; reason: string; next: string; items: ReportItem[] };

const partialGlpi = (intake: any) => intake?.approvalCoverage === "partial" || intake?.timelineCoverage === "partial" || intake?.documentsAvailable === false;

/** The area shown in the demand list, from the saved analysis and the GLPI coverage. */
export function demandArea(job: any, intake?: any) {
  if (job?.status !== "Aguardando análise") return job?.status || "";
  const missing = (job.issues || []).find((i: any) => i.field === "contractMissing");
  if (missing) return missing.label !== "Aguardando elaboração do contrato" && partialGlpi(intake) ? "Consulta ao GLPI incompleta" : missing.label;
  return (job.issues || []).find((i: any) => i.label === "Contrato não lido")?.label || job.status;
}

const blocker = /^(file:|review:|files$|processing$)/;
const fieldDetail = (r: any) => {
  if (r.status === "different") return `No contrato: ${r.found || "não informado"}. No GLPI: ${r.expected}.${r.message ? " " + r.message : ""}`;
  if (r.reviewReason?.message) return r.reviewReason.message;
  if (r.message) return r.message;
  if (r.status === "ambiguous") return `O próprio chamado informa valores diferentes (${r.expected}). Registre qual vale para esta demanda.`;
  if (r.status === "missing") return `O campo não foi localizado no contrato. No GLPI: ${r.expected}.`;
  return r.matchesReference ? "O valor coincide com o GLPI; falta confirmar a leitura no original." : "A leitura não é conclusiva. Confira o trecho no original.";
};

/** A plain summary of where the demand is, why, what is pending and what to do next. */
export function demandReport(job: any, intake?: any): DemandReport | undefined {
  if (!job) return undefined;
  const rows: any[] = job.comparisons || [], issues: any[] = job.issues || [];
  const items: ReportItem[] = [];
  for (const warning of job.supportWarnings || [])
    items.push({ kind: "aviso", title: "Comprovante bancário: " + (warning.label || warning.field), detail: warning.message, source: warning.source });
  for (const r of rows.filter(r => r.status === "different"))
    items.push({ kind: "erro", title: r.label || r.field, detail: fieldDetail(r), source: r.source });
  for (const r of rows.filter(r => ["review", "missing", "ambiguous"].includes(r.status)))
    items.push({ kind: "pendencia", title: r.label || r.field, detail: fieldDetail(r), source: r.source, action: pendingReason(r)?.action });
  for (const i of issues.filter(i => blocker.test(i.field)))
    items.push({ kind: "pendencia", title: i.label || "Documento", detail: i.message, source: i.source, action: i.pendingReason?.action });
  for (const r of rows.filter(r => r.status === "accepted"))
    items.push({ kind: "aviso", title: "Divergência aceita: " + (r.label || r.field), detail: `Documento: ${r.found}. GLPI: ${r.expected}. Justificativa de ${r.acceptance?.author || "usuário"}: ${r.acceptance?.note || ""}` });
  const named = new Set(items.map(i => i.source).filter(Boolean));
  for (const f of (job.files || []).filter((f: any) => f.readingScope === "unknown" && !named.has(f.name)))
    items.push({ kind: "pendencia", title: "Anexo ainda não identificado", source: f.name, detail: f.problem
      ? (/fake worker|cannot find module|tempor/i.test(f.problem) ? "A leitura falhou por um problema temporário do servidor; o portal vai ler o arquivo de novo." : `A leitura falhou: ${String(f.problem).slice(0, 160)}`)
      : f.method === "Identificação inicial" ? "O anexo passou só pela identificação inicial e aguarda a leitura completa. Fotos e digitalizações são lidas pelo OCR de hora em hora, das 07h40 às 19h40." : "Abra o anexo e confira se ele é o contrato." });
  if (intake?.approvalCoverage === "partial")
    items.push({ kind: "aviso", title: "Aprovações do GLPI não consultadas", detail: "A integração não tem permissão para ler as aprovações deste chamado. Se o contrato foi enviado numa aprovação, ele ainda não aparece aqui." });
  if (intake?.documentsAvailable === false)
    items.push({ kind: "aviso", title: "Lista de anexos indisponível", detail: "O GLPI não devolveu a lista de anexos deste chamado. Confira os anexos na conversa." });

  const errors = items.filter(i => i.kind === "erro").length, pending = items.filter(i => i.kind === "pendencia").length;
  const area = demandArea(job, intake);
  if (job.status === "Analisando")
    return { situation: "Lendo os documentos", reason: "O portal está lendo os anexos e comparando com o pedido do GLPI.", next: "Aguarde: o resultado aparece nesta página automaticamente.", items };
  if (job.status === "Sem erros")
    return { situation: "Sem erros", reason: "Os dados do contrato conferem com o pedido do GLPI.", next: job.supportWarnings?.length ? "Confira também os avisos dos comprovantes bancários abaixo. Eles são separados da conferência do contrato." : "Pode seguir com a demanda. A conferência verifica preenchimento e consistência, não a autenticidade das assinaturas.", items };
  if (job.status === "Aguardando correção")
    return { situation: "Aguardando correção", reason: `${errors || "Um"} campo(s) do contrato diferem do pedido no GLPI.`, next: "Solicite a correção do contrato ou da referência no GLPI, conforme cada erro abaixo.", items };
  if (job.status === "Conferência parcial")
    return { situation: "Conferência parcial", reason: `Nenhum erro encontrado, mas ${pending} item(ns) precisam de conferência humana.`, next: "Confira no original cada pendência abaixo e confirme ou corrija a leitura.", items };
  const missing = issues.find(i => i.field === "contractMissing");
  const first = issues.find(i => i.label === "Contrato não lido");
  return {
    situation: area,
    reason: area === "Consulta ao GLPI incompleta" ? "Nenhum contrato foi identificado nos anexos, e parte do chamado não pôde ser consultada no GLPI." : missing?.message || first?.message || "Aguardando a leitura do contrato.",
    next: contractStageActions[area] || "Aguarde a leitura dos documentos.",
    items,
  };
}
