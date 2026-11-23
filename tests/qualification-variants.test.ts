import { test } from "node:test";
import assert from "node:assert/strict";
import { extractQualifiedParties } from "../server/qualification-reading.js";

test("partes qualificadas com variações de redação dos contratos Kedu", () => {
  const sob = "CENTRO EDUCACIONAL MUNDO DO SABER LTDA , sociedade, cujo nome fantasia é CENTRO EDUCACIONAL MUNDO DO SABER LTDA , inscrita sob o CNPJ n° 40.217.048/0001-70, com endereço na Rua Roberto de Normandia, nº 160.";
  assert.deepEqual(extractQualifiedParties(sob).map(p => [p.name, p.cnpj]), [["CENTRO EDUCACIONAL MUNDO DO SABER LTDA", "40.217.048/0001-70"]]);
  const outro = "aqui denominado simplesmente de CREDOR , e do outro INSTITUTO EDUCACIONAL AQUARELA LTDA, sociedade inscrita no CNPJ/ME sob o nº 28.671.060/0001-55, aqui denominado(a) DEVEDOR(A) .";
  assert.equal(extractQualifiedParties(outro)[0].name, "INSTITUTO EDUCACIONAL AQUARELA LTDA");
  const sigla = "CONTRATO DE PRESTAÇÃO DE SERVIÇOS TÉCNICOS E CONTINUADOS DE MARKETING E COMUNICAÇÃO E.M DA CUNHA ESCOLA LTDA, sociedade, inscrita no CNPJ/ME sob o nº 41.073.693/0001-20, com sede na RUA CAPITAO GREGORIO, n° 161.";
  assert.equal(extractQualifiedParties(sigla)[0].name, "E.M DA CUNHA ESCOLA LTDA");
  // The conjunction itself is still not a name.
  assert.equal(extractQualifiedParties("e outra coisa, inscrita no CNPJ sob o nº 41.073.693/0001-20.").length ? extractQualifiedParties("e outra coisa, inscrita no CNPJ sob o nº 41.073.693/0001-20.")[0].name : "", "");
});

test("cidade separada por travessão, pessoa física com CPF na mesma linha e contrato social como apoio", async () => {
  const { contractReadingScope } = await import("../server/contract-reading-scope.js");
  const { extractContractParties } = await import("../server/contract-parties.js");
  const sede = "ESPACO EDUCACIONAL RUI BARBOSA, sociedade inscrita no CNPJ/ME sob o nº 21.206.805/0001-66, com sede na RUA MARIA DE LOURDES ROCHA 20 A, CJ. INOCOOP - CIDADE UNIVERSITARIA — MACEIO/AL — CEP 57072-010, neste ato representado(a) por seu sócio.";
  const fields = extractQualifiedParties(sede)[0].fields;
  assert.deepEqual([fields.cidade, fields.estado], [["MACEIO"], ["AL"]]);
  const pessoa = "CONTRATANTE: Escola Alfa LTDA, inscrita no CNPJ sob o nº 11.444.777/0001-61.\nCONTRATADO: Jair Rodrigues Melo , inscrito no CPF sob o no 529.982.247-25, residente em Fortaleza.";
  assert.ok(extractContractParties(pessoa).some(p => p.name === "Jair Rodrigues Melo" && p.cnpj === "529.982.247-25"));
  const constitutivo = { extracted: JSON.stringify({ text: "Primeira alteração e consolidação. As sócias resolvem alterar o endereço da sede da sociedade para a Rua Furnas, nº 24." }), byteLength: 100 };
  assert.equal(contractReadingScope("Documento Constitutivo e Alterações.pdf", constitutivo).kind, "support");
});
