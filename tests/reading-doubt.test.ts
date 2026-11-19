import { test } from "node:test";
import assert from "node:assert/strict";
import { spelledValue, spelledNextTo, confusedDigit, readingDoubt } from "../server/reading-doubt.js";

test("lê percentuais, valores e quantidades por extenso como no contrato", () => {
  assert.equal(spelledValue("percent", "onze vírgula oitenta e quatro por cento"), "11,84%");
  assert.equal(spelledValue("percent", "onze inteiros e oitenta e quatro centésimos por cento"), "11,84%");
  assert.equal(spelledValue("percent", "sete vírgula cinco por cento"), "7,50%");
  assert.equal(spelledValue("percent", "quatro vírgula zero cinco por cento"), "4,05%");
  assert.equal(spelledValue("percent", "setenta centésimos por cento"), "0,70%");
  assert.equal(spelledValue("percent", "cem por cento"), "100,00%");
  assert.equal(spelledValue("money", "mil quinhentos e sete reais e noventa centavos"), "1507,90");
  assert.equal(spelledValue("money", "dez mil reais"), "10000,00");
  assert.equal(spelledValue("money", "um milhão de reais"), "1000000,00");
  assert.equal(spelledValue("integer", "três"), "3");
  assert.equal(spelledValue("integer", "doze"), "12");
  // Words that are not a complete number are never guessed.
  assert.equal(spelledValue("percent", "onze vírgula oitenta e quatro"), undefined);
  assert.equal(spelledValue("percent", "taxa acordada por cento"), undefined);
  assert.equal(spelledValue("money", "mil reais por mês"), undefined);
});

test("procura o extenso entre parênteses logo depois do número lido", () => {
  const text = "Taxa de remuneração: 11,64% (onze vírgula oitenta e quatro por cento) ao mês.";
  assert.deepEqual(spelledNextTo("percent", text, "11,64%"), ["11,84%"]);
  assert.deepEqual(spelledNextTo("money", "Valor: R$ 1.800,00 (mil e oitocentos reais).", "1800,00"), ["1800,00"]);
  assert.deepEqual(spelledNextTo("percent", "Taxa: 11,64% ao mês (conforme anexo).", "11,64%"), []);
});

test("reconhece só a troca de um dígito comum na leitura", () => {
  assert.deepEqual(confusedDigit("11,64%", "11,84%"), { read: "6", requested: "8" });
  assert.equal(confusedDigit("11,24%", "11,84%"), undefined);
  assert.equal(confusedDigit("11,63%", "11,84%"), undefined, "dois dígitos diferentes");
  assert.equal(confusedDigit("1,84%", "11,84%"), undefined, "quantidade de dígitos diferente");
});

test("dúvida de leitura nunca aceita o valor do GLPI e respeita documento digital", () => {
  const spelled = "Taxa: 11,64% (onze vírgula oitenta e quatro por cento)";
  assert.equal(readingDoubt("remuneracao", "11,64%", "11,84%", [spelled], true)?.code, "spelled_value_matches_request");
  assert.equal(readingDoubt("remuneracao", "11,64%", "11,84%", [spelled], true)?.review, true);
  // In digital text the figure is certain: the document itself is inconsistent and stays an error.
  assert.equal(readingDoubt("remuneracao", "11,64%", "11,84%", [spelled], false)?.review, false);
  // Words confirming the figure that was read prove a real divergence, even for a confusable digit.
  assert.equal(readingDoubt("remuneracao", "11,64%", "11,84%", ["Taxa: 11,64% (onze vírgula sessenta e quatro por cento)"], true), undefined);
  assert.equal(readingDoubt("remuneracao", "11,64%", "11,84%", ["Taxa: 11,64%"], true)?.code, "ocr_digit_confusion");
  assert.equal(readingDoubt("remuneracao", "11,64%", "11,84%", ["Taxa: 11,64%"], false), undefined);
  assert.equal(readingDoubt("remuneracao", "5,00%", "4,58%", ["Taxa: 5,00%"], true), undefined);
  assert.equal(readingDoubt("razaoSocial", "Escola A", "Escola B", ["Escola A"], true), undefined);
});
