import { test } from "node:test";
import assert from "node:assert/strict";
import { demandKind, glpiCategoryName, countBy, demandKinds } from "../shared/demand-kind.js";

const contratos = "MeF advogados &#62; Juridico &#62; CONTRATOS";
const revisao = "MeF advogados &#62; Juridico &#62; REVISÃO";
const descredenciamento = "MeF advogados &#62; Juridico &#62; DESCREDENCIAMENTO";

test("categoria do GLPI aparece pelo último nível, sem o escape de HTML", () => {
  assert.equal(glpiCategoryName(contratos), "CONTRATOS");
  assert.equal(glpiCategoryName("A &gt; B"), "B");
  assert.equal(glpiCategoryName(""), "Sem categoria");
});

test("natureza do chamado separa contrato novo, aditivo, consultivo e descredenciamento", () => {
  assert.equal(demandKind("Contrato de garantia", contratos), "Contrato novo");
  assert.equal(demandKind("Aditivo", contratos), "Aditivo");
  assert.equal(demandKind("RENOVAÇÃO CONTRATUAL + ALTERAÇÃO DE TAXA", contratos), "Aditivo");
  assert.equal(demandKind("Parcelamento", contratos), "Outros");
  assert.equal(demandKind("A classificar", contratos), "A identificar");
  // REVISÃO is advisory work even when the document under review is a contract or an amendment.
  assert.equal(demandKind("Contrato educacional", revisao), "Consultivo (revisão)");
  assert.equal(demandKind("Aditivo", revisao), "Consultivo (revisão)");
  assert.equal(demandKind("Distrato", revisao), "Descredenciamento e distrato");
  assert.equal(demandKind("Descredenciamento", descredenciamento), "Descredenciamento e distrato");
  // Without a GLPI category, the identified type decides.
  assert.equal(demandKind("Análise contratual", null), "Consultivo (revisão)");
  assert.equal(demandKind("Contrato educacional", undefined), "Contrato novo");
});

test("contagem segue a ordem das naturezas e omite as que não têm demandas", () => {
  assert.deepEqual(countBy(["Aditivo", "Contrato novo", "Aditivo", "A identificar"], demandKinds), [
    { name: "Contrato novo", count: 1 }, { name: "Aditivo", count: 2 }, { name: "A identificar", count: 1 },
  ]);
});
