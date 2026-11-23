import { test } from "node:test";
import assert from "node:assert/strict";
import { demandReport, demandArea } from "../shared/demand-report.js";

test("relatório de demanda com erro lista o campo, o valor do contrato e o do GLPI", () => {
  const report = demandReport({ status: "Aguardando correção", issues: [], comparisons: [
    { field: "remuneracao", label: "Taxa de remuneração", status: "different", found: "5,00%", expected: "4,58%", source: "Contrato.pdf" },
    { field: "cnpj", label: "CNPJ", status: "matches", found: "1", expected: "1" },
  ] })!;
  assert.equal(report.situation, "Aguardando correção");
  assert.match(report.reason, /^1 campo/);
  assert.deepEqual(report.items.map(i => [i.kind, i.title]), [["erro", "Taxa de remuneração"]]);
  assert.match(report.items[0].detail, /No contrato: 5,00%\. No GLPI: 4,58%\./);
});

test("relatório explica a área de quem ainda não tem contrato e avisa sobre as aprovações", () => {
  const job = { status: "Aguardando análise", comparisons: [], issues: [
    { field: "contractMissing", label: "Aguardando elaboração do contrato", message: "Pedido de elaboração: os anexos são documentos de apoio." },
  ] };
  const report = demandReport(job, { approvalCoverage: "partial" })!;
  assert.equal(report.situation, "Aguardando elaboração do contrato");
  assert.match(report.reason, /Pedido de elaboração/);
  assert.match(report.next, /Elabore o contrato/);
  assert.deepEqual(report.items.map(i => i.kind), ["aviso"]);
  // A missing contract with partial GLPI coverage is shown as an incomplete query, never a drafting request.
  assert.equal(demandArea({ status: "Aguardando análise", issues: [{ field: "contractMissing", label: "Contrato não encontrado" }] }, { approvalCoverage: "partial" }), "Consulta ao GLPI incompleta");
  assert.equal(demandArea(job, { approvalCoverage: "partial" }), "Aguardando elaboração do contrato");
});

test("conferência parcial mostra cada pendência com o motivo e a próxima ação", () => {
  const report = demandReport({ status: "Conferência parcial", comparisons: [
    { field: "conta", label: "Conta", status: "review", readingPending: true, found: "5726984", expected: "572698416-8", reviewReason: { code: "ocr_truncated", message: "A conta lida é o começo da conta pedida." } },
  ], issues: [{ field: "review:f1", label: "Conferência de leitura: foto.jpeg", message: "Confira a leitura da foto.", source: "foto.jpeg" }] })!;
  assert.match(report.reason, /2 item/);
  assert.deepEqual(report.items.map(i => i.title), ["Conta", "Conferência de leitura: foto.jpeg"]);
  assert.match(report.items[0].detail, /começo da conta/);
  assert.equal(demandReport(undefined), undefined);
});

test("relatório de Tipo a confirmar cita cada anexo ainda não identificado e o motivo", () => {
  const report = demandReport({ status: "Aguardando análise", comparisons: [], issues: [{ field: "contractMissing", label: "Tipo a confirmar", message: "Ainda há anexos cujo tipo precisa ser identificado." }],
    files: [{ name: "foto.jpeg", readingScope: "unknown", method: "Identificação inicial" }, { name: "CTT.pdf", readingScope: "unknown", problem: "Setting up fake worker failed" }, { name: "cartao.pdf", readingScope: "support" }] })!;
  assert.deepEqual(report.items.map(i => i.source), ["foto.jpeg", "CTT.pdf"]);
  assert.match(report.items[0].detail, /OCR de hora em hora/);
  assert.match(report.items[1].detail, /problema temporário do servidor/);
});
