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
