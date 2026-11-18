import type { RawTicket } from "./glpi.js";
import {headingType} from '../shared/document-heading.js';
import {referenceDocuments,formatDocument} from './reference-document.js';

/** GLPI stores ticket content as HTML (often entity-encoded). Converts it to plain lines. */
export function htmlToText(html: string) {
  const decode = (s: string) =>
    s
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;|&apos;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&amp;/g, "&");
  let text = decode(decode(String(html || "")));
  text = text
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|tr|li|h\d|table)\s*>/gi, "\n")
    .replace(/<\s*\/\s*t[dh]\s*>/gi, " \t ")
    .replace(/<[^>]+>/g, " ");
  return text
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);
}

const LABELS: [string, RegExp][] = [
  ["nomeFantasia", /^(?:\d+\)\s*)?NOME FANTASIA\s*[:\-–]?\s*(.*)$/i],
  ["endereco", /^ENDERE[ÇC]O\s*[:\-–]?\s*(.*)$/i],
  ["tipoSolicitacao", /^TIPO DE SOLICITA[ÇC][ÃA]O\s*[:\-–]?\s*(.*)$/i],
  ["tipoContrato", /^TIPO DE CONTRATO\s*[:\-–]?\s*(.*)$/i],
  ["contratoEspecificado", /^ESPECIFIQUE O CONTRATO\s*[:\-–]?\s*(.*)$/i],
  ["detalhamento", /^DETALHAMENTO DO ITEM DO CONTRATO\s*[:\-–]?\s*(.*)$/i],
  ["razaoSocial", /^(?:\d+\)\s*)?RAZ[ÃA]O SOCIAL\s*[:\-–]?\s*(.*)$/i],
  ["cnpj", /^(?:\d+\)\s*)?CNPJ\s*[:\-–]?\s*(.*)$/i],
  ["motivo", /^(?:\d+\)\s*)?MOTIVO(?: DO ADITIVO)?\s*[:\-–]?\s*(.*)$/i],
  ["observacoes", /^(?:\d+\)\s*)?OBSERVA[ÇC][ÕO]ES(?: OU CONSIDERA[ÇC][ÕO]ES ADICIONAIS)?\s*[:\-–]?\s*(.*)$/i],
  ["anexos", /^(?:\d+\)\s*)?ANEXOS\s*[:\-–]?\s*(.*)$/i],
  // Only used for cross-checking when the form has such a field; the real form mapping is pending.
  ["remuneracao", /^(?:\d+\)\s*)?TAXA(?: DE REMUNERA[ÇC][ÃA]O)?(?: KEDU)?\s*[:\-–]\s*(.*)$/i],
];
/** Reads "LABEL: value" pairs of the GLPI form answer; a label alone takes the next line. */
export function extractFields(lines: string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    for (const [key, pattern] of LABELS) {
      const m = pattern.exec(lines[i]);
      if (!m || out[key]) continue;
      let value = m[1].trim();
      if (!value && lines[i + 1] && !LABELS.some(([, p]) => p.test(lines[i + 1]))) value = lines[i + 1].trim();
      out[key] = value;
    }
  }
  return out;
}
export function cnpjDigits(value: string) {
  return String(value || "").replace(/\D/g, "");
}
export function validCnpj(value: string) {
  const d = cnpjDigits(value);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((s, w, i) => s + w * Number(d[i]), 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}
export const formatCnpj = (d: string) =>
  d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : d;

const SUBTYPE_HINTS: [string, RegExp][] = [
  ["Migração de modalidade", /migra[çc][ãa]o|mudan[çc]a de modalidade|garantia (completa|conjunta|prevista) para/i],
  ["Vigência", /vig[êe]ncia|in[íi]cio de contrato|t[ée]rmino|prorroga/i],
  ["Conta bancária", /conta banc|dados banc|ag[êe]ncia|\bpix\b/i],
  ["Percentual/data de repasse", /repasse/i],
  ["Cashback", /cash ?back/i],
  ["Taxa de remuneração", /\btaxa\b|remunera[çc][ãa]o/i],
];
const MONTH = "(janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)";

export type TicketAnalysis = {
  fields: Record<string, { value: string; origin: string }>;
  suggestion: { type: string; subtype: string; basis: string };
  schoolId: string | null;
  organizationId: string | null;
  matrixId: string | null;
  pendencies: string[];
  /** Several valid identifiers in the CNPJ field: the documents or a person choose among them. */
  organizationCandidates: string[];
};
/** Organises a ticket without inventing data: every value keeps its origin and gaps become pendencies. */
export function analyzeTicket(
  ticket: RawTicket,
  context: { schools: { id: string; cnpj: string; legal_name: string; organization_kind?: string }[]; matrices: { id: string; school_id: string }[] },
): TicketAnalysis {
  const origin = `GLPI #${ticket.externalId} — formulário do chamado`;
  const lines = htmlToText(ticket.content);
  const raw = extractFields(lines);
  const fields: TicketAnalysis["fields"] = {};
  const pendencies: string[] = [];
  for (const [key, value] of Object.entries(raw)) if (value) fields[key] = { value, origin };
  if (!raw.razaoSocial) pendencies.push("Razão social não identificada no formulário do chamado");
  let schoolId: string | null = null;
  let organizationId: string | null = null;
  let organizationCandidates: string[] = [];
  if (!raw.cnpj) pendencies.push("CNPJ não identificado no formulário do chamado");
  else {
    const references = referenceDocuments(raw.cnpj);
    const reference = references.length === 1 ? references[0] : undefined;
    const digits = reference?.digits ?? cnpjDigits(raw.cnpj);
    if (reference) fields.cnpj = { value: formatDocument(digits), origin: origin + " (normalizado de “" + raw.cnpj + "”" + (reference.repaired ? "; formato do campo numérico corrigido e conferido pelo dígito verificador" : "") + ")" };
    else if (digits.length === 14) fields.cnpj = { value: formatCnpj(digits), origin: origin + " (normalizado de “" + raw.cnpj + "”)" };
    if (references.length > 1) {
      organizationCandidates = references.map((r) => r.digits);
      pendencies.push("O chamado informa mais de um CNPJ/CPF (" + references.map((r) => formatDocument(r.digits)).join("; ") + "); a organização é definida pelos documentos ou no recebimento");
    } else if (!reference && digits.length !== 14) pendencies.push("CNPJ informado com quantidade de dígitos inválida: " + raw.cnpj);
    else if (!reference && !validCnpj(digits)) pendencies.push("CNPJ com dígito verificador inválido; confira no cartão CNPJ");
    const school = references.length > 1 ? undefined : context.schools.find((s) => cnpjDigits(s.cnpj) === digits);
    if (!school) {
      if (references.length <= 1) pendencies.push("Escola com este CNPJ não está cadastrada na central");
    }
    else {
      organizationId = school.id;
      if (!school.organization_kind || school.organization_kind === "Escola") schoolId = school.id;
      else if (school.organization_kind === "Aguardando classificação") pendencies.push("Organização encontrada, mas aguarda classificação em Organizações → Aguardando classificação");
      else pendencies.push("Organização classificada como " + school.organization_kind + "; selecione um tipo de demanda compatível");
      if (raw.razaoSocial && normalize(raw.razaoSocial) !== normalize(school.legal_name))
        pendencies.push("Razão social do chamado difere do cadastro da escola; confirme na Receita Federal");
    }
  }
  const narrative = [raw.motivo, raw.observacoes, raw.detalhamento, raw.contratoEspecificado, ticket.title].filter(Boolean).join(" \n ");
  if (!fields.remuneracao) {
    const changes = [...narrative.matchAll(/(?:taxa|remunera[çc][ãa]o)\s+de\s+(\d{1,3}(?:[.,]\d{1,2})?)\s*%\s+para\s+(\d{1,3}(?:[.,]\d{1,2})?)\s*%/gi)];
    if (changes.length === 1 && Number(changes[0][2].replace(",", ".")) <= 100) fields.remuneracao = {value:Number(changes[0][2].replace(",", ".")).toFixed(2).replace(".", ",")+"%",origin:origin+" — nova taxa explicitamente solicitada em “"+changes[0][0]+"” (confirmar documentalmente)"};
  }
  const hint = SUBTYPE_HINTS.find(([, pattern]) => pattern.test(narrative));
  const isAddendum = /aditivo/i.test(ticket.title + " " + (raw.motivo || ""));
  let suggestion = { type: "", subtype: "", basis: "" };
  if (hint?.[0] === "Migração de modalidade")
    suggestion = { type: "Migração de modalidade", subtype: "", basis: "Texto do chamado cita migração de modalidade (exige distrato e novo contrato)" };
  else if (/parcelamento de d[ée]bitos|parcelamento de d[íi]vida/i.test(raw.motivo || raw.tipoSolicitacao || ""))
    suggestion = {type:"Parcelamento",subtype:"",basis:"Motivo do formulário solicita explicitamente parcelamento de débitos; confirmar o modelo correspondente"};
  else if (isAddendum)
    suggestion = { type: "Aditivo", subtype: hint?.[0] || "", basis: hint ? "Palavras do motivo/observações: sugestão a confirmar" : "Chamado de aditivo sem tipo identificável" };
  else if (/kedu matr[íi]culas|contrato educacional/i.test([raw.contratoEspecificado, raw.tipoContrato].join(" ")))
    suggestion = { type: "Contrato educacional", subtype: "", basis: "Formulário cita Kedu Matrículas/contrato educacional; confirmar após revisar os anexos" };
  else if (/SOLICITA[ÇC][ÃA]O DE CONTRATO PARA ESCOLAS/i.test(ticket.title))
    suggestion = { type: "Contrato de garantia", subtype: "", basis: "Formulário de contrato para escolas; confirmar o instrumento e a modalidade" };
  if(!suggestion.type){const type=headingType(ticket.title);if(type && type!=="Contrato")suggestion={type,subtype:"",basis:"Tipo explicitamente identificado no início do título do chamado GLPI; confirmar com o documento"};}
  if(!suggestion.type){
    const requested=raw.tipoSolicitacao||'';
    const family=raw.contratoEspecificado||raw.tipoContrato||'';
    const type=/an[áa]lise contratual/i.test(ticket.title)?'Análise contratual':/descredenciamento/i.test(ticket.title)?'Descredenciamento':/distrato/i.test(requested)?'Distrato':/aditivo/i.test(requested)?'Aditivo':/fornecedor/i.test(family)?'Contrato fornecedor':/matr[íi]cula|escola\s*\/\s*respons/i.test(family)?'Contrato educacional':/marketing/i.test(family)?'Contrato marketing':/parceria/i.test(family)?'Contrato de parceria':family && !/outros tipos/i.test(family)?family:'';
    if(type)suggestion={type,subtype:'',basis:'Tipo de solicitação e especificação informados no formulário GLPI'};
  }
  if (!suggestion.type) pendencies.push("Tipo de demanda não identificado; classifique manualmente");
  else if (suggestion.type === "Aditivo" && !suggestion.subtype) pendencies.push("Tipo específico de aditivo não identificado");
  if (suggestion.subtype === "Vigência") {
    const text = narrative;
    const monthYear = new RegExp(MONTH + "\\s*(?:/|de)\\s*\\d{4}", "i").test(text);
    const exactDay = new RegExp("\\b\\d{1,2}(?:º)?\\s*(?:/\\s*\\d{1,2}\\s*/|de\\s+" + MONTH + ")", "i").test(text);
    if (!exactDay)
      pendencies.push(
        monthYear
          ? "Dia exato da nova vigência não informado (o chamado cita apenas mês/ano); confirme com o solicitante"
          : "Datas da nova vigência não informadas",
      );
    if (!/t[ée]rmino|fim da vig|data final|encerramento da vig|prorroga|dura[çc][ãa]o/i.test(text))
      pendencies.push("Efeito sobre a data final e a duração da vigência não informado");
  }
  const matrices = schoolId ? context.matrices.filter((m) => m.school_id === schoolId) : [];
  if (schoolId && !matrices.length) pendencies.push("Nenhum contrato matriz assinado cadastrado para a escola");
  if (matrices.length > 1) pendencies.push("Mais de um contrato matriz assinado; selecione o contrato correto");
  const matrixId = matrices.length === 1 ? matrices[0].id : null;
  if (!ticket.documentsAvailable)
    pendencies.push("Anexos do chamado não puderam ser lidos pela API (verifique permissões); conferir diretamente no GLPI");
  else if (raw.anexos && !ticket.documents.length)
    pendencies.push("O formulário cita anexos, mas nenhum documento foi retornado pela API");
  if (ticket.documents.length)
    pendencies.push("Anexos listados apenas como referência: baixe, confira e registre cada evidência verificada");
  if (ticket.documents.some((d) => /aditivo/i.test(d.name)) || /aditivo/i.test(raw.observacoes || ""))
    pendencies.push(
      "Arquivo ou texto que menciona aditivo anterior não comprova a sequência assinada; confirme o último aditivo no Clicksign/Clint",
    );
  if (suggestion.type === "Aditivo")
    pendencies.push("Número sequencial do aditivo depende da confirmação manual do último assinado no Clicksign/Clint");
  return { fields, suggestion, schoolId, organizationId, matrixId, pendencies, organizationCandidates };
}
/** Compares the confirmed demand data with what the linked ticket states (validation approach). */
export function crossCheck(analysis: TicketAnalysis, ticketId: string, data: Record<string, any>) {
  const issues: string[] = [];
  const cnpj = analysis.fields.cnpj?.value;
  if (cnpj && data.cnpj && cnpjDigits(cnpj) !== cnpjDigits(data.cnpj))
    issues.push(`CNPJ da demanda difere do informado no chamado GLPI #${ticketId} (${cnpj})`);
  const name = analysis.fields.razaoSocial?.value;
  if (name && data.razaoSocial && normalize(name) !== normalize(data.razaoSocial))
    issues.push(`Razão social da demanda difere do chamado GLPI #${ticketId}; confirme na Receita Federal`);
  const rate = analysis.fields.remuneracao?.value;
  const percent = (v: string) => {
    const m = /(\d{1,3})(?:[.,](\d{1,2}))?\s*%/.exec(v || "");
    return m ? Number(m[1]) * 100 + Number((m[2] || "0").padEnd(2, "0")) : null;
  };
  if (rate && data.remuneracao && percent(rate) !== null && percent(rate) !== percent(data.remuneracao))
    issues.push(`Taxa da demanda (${data.remuneracao}) difere da taxa do chamado GLPI #${ticketId} (${rate})`);
  return issues;
}
function normalize(s: string) {
  return String(s || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}
