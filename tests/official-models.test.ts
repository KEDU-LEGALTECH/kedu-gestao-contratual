import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "kedu-official-")), "test.sqlite");
process.env.NODE_ENV = "test";
process.env.DEMO_SEED = "true";
const { default: app } = await import("../server/index.js");
const { one, all, run } = await import("../server/db.js");
const { paragraphs, demoTemplate } = await import("../server/documents.js");
const { requirements, humanAxes } = await import("../server/governance.js");
const { cardinal, dateWords, moneyWords, percentWords, ordinal, wholeMonths } =
  await import("../shared/extenso.js");
const { deriveOfficial, officialProblems } = await import("../shared/official-fields.js");
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.on("listening", resolve));
after(() => server.close());
const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
async function request(path: string, body?: any, cookie = "", method?: string) {
  const res = await fetch(base + path, {
    method: method || (body ? "POST" : "GET"),
    headers: { "Content-Type": "application/json", cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json(), cookie: res.headers.get("set-cookie")?.split(";")[0] || "" };
}
const login = async (email: string) =>
  (await request("/login", { email, password: "Kedu-demo-2026!" })).cookie;
const admin = await login("admin@demo.kedu.local");
const juridico = await login("juridico@demo.kedu.local");
const risco = await login("risco@demo.kedu.local");
async function upload(path: string, fields: Record<string, string>, file: Buffer, name: string, cookie = admin) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append("file", new Blob([new Uint8Array(file)]), name);
  const res = await fetch(base + path, { method: "POST", headers: { cookie }, body: form });
  return { status: res.status, data: await res.json() };
}
const ok = (r: { status: number; data: any }) => assert.equal(r.status, 200, JSON.stringify(r.data));

test("Extensos, datas e meses inteiros seguem a grafia usada nos modelos", () => {
  assert.equal(cardinal(11), "onze");
  assert.equal(cardinal(21), "vinte e um");
  assert.equal(cardinal(2, "f"), "duas");
  assert.equal(cardinal(1500), "mil e quinhentos");
  assert.equal(cardinal(2340), "dois mil trezentos e quarenta");
  assert.equal(cardinal(1_200_000), "um milhão e duzentos mil");
  assert.equal(moneyWords("10.000,00"), "dez mil reais");
  assert.equal(moneyWords("R$ 1.000.000,00"), "um milhão de reais");
  assert.equal(moneyWords("1.250,50"), "mil duzentos e cinquenta reais e cinquenta centavos");
  assert.equal(percentWords("7,70%"), "sete inteiros e setenta centésimos por cento");
  assert.equal(percentWords("100,00%"), "cem por cento");
  assert.equal(ordinal(2), "segundo");
  assert.equal(ordinal(11), "décimo primeiro");
  assert.equal(dateWords("2026-11-01"), "1º de novembro de 2026");
  assert.equal(dateWords("2027-10-31"), "31 de outubro de 2027");
  assert.equal(wholeMonths("2026-11-01", "2027-10-31"), 12);
  assert.equal(wholeMonths("2026-11-01", "2027-11-01"), 12);
  assert.equal(wholeMonths("2026-11-01", "2027-11-15"), null);
  assert.throws(() => dateWords("2026-02-30"));
});

test("Derivação não inventa dados e aponta duração incompatível", () => {
  const values = deriveOfficial({ inicio: "2026-11-01" }, { sequence: 2, notice: "" });
  assert.equal(values.ordinalAditivo, "SEGUNDO ADITIVO AO");
  assert.equal(values.inicioExtenso, "1º de novembro de 2026");
  assert.equal(values.fimExtenso, undefined);
  assert.equal(deriveOfficial({ garantia: "70,00%" }, { notice: "" }).percentualRestante, "30,00%");
  assert.deepEqual(
    officialProblems("Aditivo", "Vigência", { inicio: "2026-11-01", fim: "2027-10-31", duracaoMeses: "11" }),
    ["Duração informada (11 meses) difere do intervalo entre início e fim (12 meses)"],
  );
  assert.equal(
    officialProblems("Contrato de garantia", "", { modalidade: "Garantia Completa", inicio: "2026-11-15" }).length,
    1,
  );
});

test("Catálogo oficial é registrado uma única vez, sem homologação automática", async () => {
  const official = (await request("/templates/official", undefined, admin)).data;
  assert.equal(official.length, 8);
  assert.ok(official.every((t: any) => t.status === "rascunho" && !t.homologated_at));
  const { registerOfficialCatalog } = await import("../server/official-templates.js");
  assert.equal(registerOfficialCatalog().registered, 0);
  assert.equal(all("SELECT * FROM template_sources").length, 8);
  const vigencia = official.find((t: any) => t.subtype === "Vigência");
  const r = await request("/templates/" + vigencia.version_id + "/approve", {}, juridico);
  assert.equal(r.status, 400);
});

test("Aditivo de vigência ponta a ponta com o modelo oficial: prévia, homologação, geração, aprovação e assinatura", async () => {
  run("INSERT INTO contracts(id,school_id,status) VALUES('matriz-oficial','s2','Assinado')");
  ok(
    await request(
      "/contracts/matriz-oficial/signed-history",
      { sequence: 1, source: "Clicksign", reference: "Primeiro aditivo fictício conferido", signatureDate: "2026-03-01", attested: true },
      admin,
    ),
  );
  const created = await request(
    "/demands",
    { school_id: "s2", type: "Aditivo", subtype: "Vigência", owner: "u2", priority: "Normal", due: "2030-01-01", matrix: "matriz-oficial", glpi_id: "TESTE-OFICIAL-1" },
    admin,
  );
  ok(created);
  const did = created.data.id;
  const path = "/demands/" + did;
  assert.equal(one("SELECT sequence FROM contracts WHERE id=(SELECT contract_id FROM demands WHERE id=?)", did).sequence, 2);
  const version = () => one("SELECT data_version FROM demands WHERE id=?", did).data_version;
  ok(
    await request(
      path + "/baseline",
      {
        expected_version: version(),
        reference: "Contrato matriz e primeiro aditivo fictícios conferidos",
        attested: true,
        data: { inicio: "2026-10-01", fim: "2027-09-30", duracaoMeses: "12" },
      },
      admin,
      "PUT",
    ),
  );
  ok(
    await request(
      path + "/governance",
      {
        subtype: "Vigência",
        reportDate: "2030-01-04",
        signingMode: "Administrador nomeado",
        partnerCount: 1,
        signers: [{ name: "Maria Ficticia", email: "maria@example.com", capacity: "Administrador" }],
        legalFlags: [],
      },
      admin,
      "PUT",
    ),
  );
  const d0 = one("SELECT * FROM demands WHERE id=?", did);
  for (const kind of requirements(d0).evidence) {
    ok(await upload(path + "/evidence", { kind }, demoTemplate(), "evidencia.docx"));
    const e = one("SELECT id FROM evidence_files WHERE demand_id=? AND kind=? ORDER BY rowid DESC LIMIT 1", did, kind);
    ok(await request(path + "/evidence/" + e.id + "/verify", { attested: true }, admin));
  }
  const official = (await request(path, undefined, admin)).data.official;
  const template = official.templates.find((t: any) => t.subtype === "Vigência");
  assert.ok(template, "modelo oficial de vigência disponível para a demanda");
  // Partial data: the preview shows gaps instead of inventing them and is marked as not signable.
  ok(await request(path + "/data", { expected_version: version(), inicio: "2026-11-01" }, admin, "PUT"));
  let preview = await request(path + "/preview", { template_version: template.version_id }, admin);
  ok(preview);
  assert.ok(preview.data.gaps.includes("Duração em meses"));
  let stored = one("SELECT * FROM template_previews WHERE id=?", preview.data.id);
  let text = paragraphs(Buffer.from(stored.bytes)).join("\n");
  assert.match(text, /PENDENTE DE HOMOLOGAÇÃO JURÍDICA — NÃO UTILIZAR PARA ASSINATURA/);
  assert.match(text, /⟨PENDENTE: Duração em meses⟩/);
  assert.equal(one("SELECT COUNT(*) n FROM documents WHERE demand_id=?", did).n, 0);
  const data = {
    expected_version: version(),
    nomeFantasia: "Escola Fictícia",
    rua: "Rua das Flores",
    numero: "123",
    bairro: "Centro",
    cidade: "Fortaleza",
    estado: "CE",
    cep: "60000-000",
    representanteNome: "Maria Fictícia",
    representanteCpf: "000.000.000-00",
    inicio: "2026-11-01",
    fim: "2027-10-31",
    duracaoMeses: "11",
    dataAssinaturaMatriz: "2026-01-15",
    dataFormalizacao: "2026-10-20",
    localidade: "Fortaleza, CE",
    endereco: "Rua das Flores, 123 — Centro, Fortaleza, CE",
    motivo: "Início transferido de outubro para novembro de 2026 (dados fictícios)",
    checklist: true,
  };
  ok(await request(path + "/data", data, admin, "PUT"));
  let detail = (await request(path, undefined, admin)).data;
  assert.ok(detail.missing.some((m: string) => m.startsWith("Duração informada (11 meses)")));
  assert.equal((await request(path + "/confirm", {}, admin)).status, 400);
  ok(await request(path + "/data", { expected_version: version(), duracaoMeses: "12" }, admin, "PUT"));
  detail = (await request(path, undefined, admin)).data;
  assert.deepEqual(detail.missing, []);
  ok(await request(path + "/confirm", {}, admin));
  // Before homologation the official template cannot produce a document for signature.
  let r: { status: number; data: any } = await request(path + "/generate", { template_version: template.version_id }, admin);
  assert.equal(r.status, 400);
  assert.match(r.data.error, /pendente de homologação/);
  preview = await request(path + "/preview", { template_version: template.version_id }, admin);
  ok(preview);
  assert.deepEqual(preview.data.gaps, []);
  stored = one("SELECT * FROM template_previews WHERE id=?", preview.data.id);
  // A downloaded preview can never be uploaded as the draft for signature.
  r = await upload(path + "/upload", { template_version: template.version_id }, Buffer.from(stored.bytes), "previa.docx");
  assert.equal(r.status, 400);
  // Homologation is a legal decision with reference and attestation; Risk cannot do it.
  assert.equal((await request("/templates/" + template.version_id + "/homologate", { reference: "Ata fictícia de homologação 01/2026", attested: true }, risco)).status, 403);
  ok(await request("/templates/" + template.version_id + "/homologate", { reference: "Ata fictícia de homologação 01/2026", attested: true }, juridico));
  assert.equal((await request("/templates/" + template.version_id + "/homologate", { reference: "Ata fictícia de homologação 01/2026", attested: true }, juridico)).status, 400);
  assert.throws(() => run("DELETE FROM template_homologations WHERE version_id=?", template.version_id));
  ok(await request(path + "/generate", { template_version: template.version_id }, admin));
  const document = one("SELECT * FROM documents WHERE demand_id=? ORDER BY version DESC LIMIT 1", did);
  text = paragraphs(Buffer.from(document.bytes)).join("\n");
  assert.match(text, /SEGUNDO ADITIVO AO CONTRATO DE GESTÃO E COBRANÇA DE RECEBÍVEIS/);
  assert.match(text, /celebrado em 15 de janeiro de 2026/);
  assert.match(text, /Vigência iniciada no dia 1º de novembro de 2026 com previsão de término da vigência em 31 de outubro de 2027, com duração de 12 \(doze\) meses\./);
  assert.match(text, /Fortaleza,CE, 20 de outubro de 2026\./);
  assert.doesNotMatch(text, /NÃO UTILIZAR PARA ASSINATURA|⟨PENDENTE/);
  const snapshot = JSON.parse(document.snapshot);
  assert.equal(snapshot.anteriorInicio, "2026-10-01");
  assert.equal(snapshot.avisoHomologacao, "");
  assert.equal((await request(path + "/review", {}, admin)).data.status, "conforme");
  // A tampered copy of the official model is detected field by field.
  const tampered = Buffer.from(document.bytes);
  const PizZip = (await import("pizzip")).default;
  const zip = new PizZip(tampered);
  zip.file("word/document.xml", zip.file("word/document.xml")!.asText().replace("31 de outubro de 2027", "30 de novembro de 2027"));
  ok(await upload(path + "/upload", {}, zip.generate({ type: "nodebuffer" }), "minuta-alterada.docx"));
  const divergent = await request(path + "/review", {}, admin);
  assert.equal(divergent.data.status, "divergente");
  assert.ok(divergent.data.results.some((f: any) => f.field === "fimExtenso"));
  ok(await request(path + "/stage", { stage: "Em elaboração" }, admin));
  ok(await request(path + "/generate", { template_version: template.version_id }, admin));
  assert.equal((await request(path + "/review", {}, admin)).data.status, "conforme");
  for (const axis of humanAxes)
    ok(await request(path + "/human-check", { axis, result: "Aprovado", notes: "Conferência humana fictícia do modelo oficial." }, admin));
  ok(await request(path + "/stage", { stage: "Em aprovação" }, admin));
  assert.deepEqual(requirements(one("SELECT * FROM demands WHERE id=?", did)).approvals, ["Risco"]);
  ok(await request(path + "/approve", { kind: "Risco" }, risco));
  ok(await request(path + "/stage", { stage: "Em assinatura" }, admin));
  assert.equal((await request(path + "/stage", { stage: "Concluído" }, admin)).status, 400);
  const pdf = Buffer.from("%PDF-1.4\n% Arquivo fictício declarado como assinado\n%%EOF");
  ok(await upload(path + "/signature", { attested: "true" }, pdf, "assinado.pdf"));
  ok(await request(path + "/stage", { stage: "Concluído" }, admin));
  assert.equal(one("SELECT MAX(sequence) n FROM signed_history WHERE matrix_id='matriz-oficial'").n, 2);
  const contract = one("SELECT * FROM contracts WHERE id=(SELECT contract_id FROM demands WHERE id=?)", did);
  assert.deepEqual([contract.status, contract.start, contract.end], ["Assinado", "2026-11-01", "2027-10-31"]);
});

test("Os oito modelos oficiais geram documentos estruturados conferidos sem divergência", async () => {
  const { generateStructured, reviewStructured, inspectStructured } = await import("../server/structured-docx.js");
  const catalog = JSON.parse(readFileSync("templates/official/catalog.json", "utf8"));
  assert.equal(catalog.length, 8);
  for (const entry of catalog) {
    const bytes = readFileSync("templates/official/" + entry.file);
    assert.deepEqual(inspectStructured(bytes).slots, entry.slots);
    const values = Object.fromEntries(entry.slots.map((k: string) => [k, k === "avisoHomologacao" ? "" : "valor de " + k]));
    const generated = generateStructured(bytes, values);
    assert.equal(reviewStructured(generated, values, bytes).status, "conforme", entry.file);
    assert.doesNotMatch(paragraphs(generated).join(" "), /\{\{|XX|\(DIGITAR|\[DATA DE/);
  }
  const bank = catalog.find((e: any) => e.subtype === "Conta bancária");
  // Regression: "TITULAR DA CONTA" must receive the account holder, not the account number.
  const text = paragraphs(
    generateStructured(
      readFileSync("templates/official/" + bank.file),
      Object.fromEntries(bank.slots.map((k: string) => [k, k === "avisoHomologacao" ? "" : "<" + k + ">"])),
    ),
  ).join("\n");
  assert.match(text, /TITULAR DA CONTA: <titularConta>/);
  assert.match(text, /CONTA: <conta>/);
});
