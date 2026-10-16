import { test } from "node:test";
import assert from "node:assert/strict";
import { validateData } from "../shared/data-validation.js";
test("Validação identifica cada campo inválido sem impedir rascunhos incompletos", () => {
  assert.deepEqual(validateData({}), {});
  const issues = validateData({ remuneracao: "3,3", repasse: "110,00%", valor: "abc", cnpj: "123", inicio: "2027-01-01", fim: "2026-01-01" });
  for (const key of ["remuneracao", "repasse", "valor", "cnpj", "fim"]) assert.ok(issues[key]);
  assert.deepEqual(validateData({ remuneracao: "3,30%", repasse: "96,70%", valor: "10000,00", cnpj: "12.345.678/0001-95" }), {});
});
test("Validação rejeita datas inexistentes e modalidade desconhecida", () => {
  const issues = validateData({ inicio: "2027-02-30", modalidade: "Outra" });
  assert.ok(issues.inicio);
  assert.ok(issues.modalidade);
});
