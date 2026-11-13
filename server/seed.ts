import { db, one, run, hash, now, sql } from "./db.js";
import { demoTemplate, fixed, generate, review } from "./documents.js";
import { saveTerms } from "./workflow.js";
import { saveDetails, nextReport, humanAxes } from "./governance.js";
export const roles = [
  "Administrador",
  "Solicitante",
  "Operação",
  "Jurídico",
  "Aprovador",
  "Consulta",
];
export async function seed() {
  if (process.env.NODE_ENV === "production" || process.env.DEMO_SEED !== "true") return;
  if ((await sql.one("SELECT value FROM settings WHERE key='demoDisabled'"))?.value === "true") return;
  if (await sql.one("SELECT id FROM demands LIMIT 1")) return;
  for (const [i, role] of roles.entries())
    await sql.run("INSERT OR IGNORE INTO users VALUES(?,?,?,?,?)", "u" + i, [
        "Marina Costa",
        "Lucas Alves",
        "Ana Oliveira",
        "Beatriz Santos",
        "Pedro Lima",
        "Clara Rocha",
      ][i], ["admin", "solicitante", "operacao", "juridico", "aprovador", "consulta"][
        i
      ] + "@demo.kedu.local", role, hash(process.env.DEMO_PASSWORD || "Kedu-demo-2026!"));
  await sql.run("INSERT OR IGNORE INTO templates VALUES(?,?,?)", "t1", "Quadro resumo • Garantia educacional", "Contrato");
  await sql.run("INSERT OR IGNORE INTO template_versions VALUES(?,?,?,?,?,?,?)", "tv1", "t1", 1, "aprovado", fixed, demoTemplate(), "u0");
  const names = [
    "Colégio Horizonte",
    "Escola Aprender Mais",
    "Instituto Sementes",
    "Colégio Nova Geração",
    "Escola Caminhos",
    "Centro Educacional Aurora",
    "Colégio Monte Azul",
    "Escola Vila das Letras",
  ];
  const stages = [
    "Em elaboração",
    "Aguardando informações",
    "Em conferência",
    "Em aprovação",
    "Concluído",
    "Em assinatura",
    "Recebido",
    "Recebido",
  ];
  for (const [i, name] of names.entries()) {
    const cnpj = `${String(10 + i)}.234.567/0001-90`;
    await sql.run("INSERT OR IGNORE INTO schools(id,name,legal_name,cnpj,address,contact) VALUES(?,?,?,?,?,?)", "s" + i, name, name + " Educação Ltda.", cnpj, "Fortaleza, CE • Dados fictícios", "contato@escola.example");
    await sql.run("INSERT OR IGNORE INTO representatives VALUES(?,?,?,?)", "r" + i, "s" + i, "Representante demonstrativo", "representante@example.com");
    await sql.run("INSERT OR IGNORE INTO contracts(id,school_id,start,\"end\",status) VALUES(?,?,?,?,?)", "c" + i, "s" + i, "2026-01-01", "2028-01-01", i === 4 ? "Assinado" : "Em preparação");
    const data = {
      cnpj,
      razaoSocial: name + " Educação Ltda.",
      remuneracao: "7,70%",
      garantia: "100,00%",
      repasse: "92,30%",
      cashback: "0,00%",
      valor: "R$ 10.000,00",
      banco: "001",
      agencia: "1234",
      conta: i === 1 ? "" : "12345-6",
      inicio: "2026-01-01",
      fim: "2028-01-01",
      dataRepasse: "2026-11-10",
      nomeFantasia: name,
      rua: "Rua Demonstrativa",
      numero: "100",
      bairro: "Centro",
      cidade: "Fortaleza",
      estado: "Ceará",
      cep: "60000-000",
      representanteNome: "Administrador Fictício",
      representanteCpf: "000.000.000-00",
      duracaoMeses: "24",
      alunos: "300",
      incorporaMatricula: "Não",
      cashbackValor: "0,00",
      parcelas: "1",
      diaRepasse: "10",
      titularConta: name + " Educação Ltda.",
      documentoTitular: cnpj,
      modalidade: "Garantia Completa",
      endereco: "Rua Demonstrativa, 100 — Fortaleza, CE",
      localidade: "Fortaleza, CE",
      dataFormalizacao: "2026-10-15",
      matriz: "c" + i,
      aditivo: "Não aplicável",
      checklist: i !== 1,
    };
    const created = new Date(Date.now() - (i + 3) * 86400000).toISOString();
    await sql.run("INSERT INTO demands VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", `KD-${String(i + 1).padStart(4, "0")}`, String(2840 + i), "s" + i, "c" + i, "Contrato de garantia", stages[i], i === 2 ? "Urgente" : i % 2 ? "Alta" : "Normal", "u2", new Date(Date.now() + (i - 2) * 86400000).toISOString().slice(0, 10), JSON.stringify(data), 1, i === 1 ? 0 : 1, created, i === 4 ? now() : null);
    const did = `KD-${String(i + 1).padStart(4, "0")}`;
    await saveDetails(did, {
      subtype: "",
      reportDate: nextReport(),
      signingMode: "Administrador nomeado",
      partnerCount: 1,
      signers: [
        {
          name: "Administrador Fictício",
          email: "administrador@example.com",
          capacity: "Administrador",
        },
      ],
      legalFlags: [],
    });
    if (i !== 1) for (const kind of ['contrato_social','identificacao','cartao_cnpj','comprovante_bancario'])
      await sql.run("INSERT INTO evidence_files VALUES(?,?,?,?,?,?,?,?,?,?)", "e-demo-" + i + '-' + kind, did, kind, "DEMONSTRAÇÃO — " + kind + ".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", demoTemplate(), "u0", now(), "u0", now());
    if (i >= 2 && i <= 5) {
      const bytes = generate(
        demoTemplate(),
        i === 2 ? ({ ...data, remuneracao: "7,80%" } as any) : (data as any),
      );
      await sql.run("INSERT INTO documents VALUES(?,?,?,?,?,?,?,?,?,?)", "doc" + i, `KD-${String(i + 1).padStart(4, "0")}`, 1, "tv1", 1, JSON.stringify(data), bytes, i === 4 ? bytes : null, "u2", now());
      const result = review(bytes, data as any, demoTemplate());
      for (const axis of humanAxes)
        await sql.run("INSERT INTO human_checks VALUES(?,?,?,?,?,?,?,?)", "hc-demo-" + i + axis, "doc" + i, 1, axis, "Aprovado", "Revisão fictícia para demonstração; sem validação jurídica real.", "u0", now());
      await sql.run("INSERT INTO reviews VALUES(?,?,?,?,?,?)", "rev" + i, "doc" + i, result.status, JSON.stringify(result.results), "u2", now());
      if (i > 3) {
        for (const kind of ["Risco", "Jurídica"])
          await sql.run("INSERT INTO approvals VALUES(?,?,?,?,?,?,?)", `ap${i}${kind}`, "doc" + i, 1, kind, "u0", now(), 1);
      }
    }
  }
  await sql.run("INSERT INTO settings VALUES(?,?)", "glpiMapping", JSON.stringify({
      externalId: "id",
      schoolName: "name",
      description: "content",
    }));
  await sql.run("INSERT INTO settings VALUES(?,?)", "legalPolicies", JSON.stringify([
      "Alteração do corpo fixo",
      "Distrato",
      "Migração de modalidade",
      "CNPJ solidário",
    ]));
}
if (process.env.NODE_ENV === "production" && process.env.DEMO_SEED === "true")
  throw Error("Carga demonstrativa proibida em produção.");
if (process.env.NODE_ENV === "production" && await sql.one("SELECT id FROM users WHERE email LIKE '%@demo.kedu.local' LIMIT 1"))
  throw Error("Banco contém contas demonstrativas. Use um banco separado com usuários reais em produção.");
await seed();
if (process.env.NODE_ENV !== "production" && process.env.DEMO_SEED === "true" && (await sql.one("SELECT value FROM settings WHERE key='demoDisabled'"))?.value !== "true") {
for (const [i, role, email, name] of [
  [6, "Risco", "risco@demo.kedu.local", "Risco demonstrativo"],
  [7, "Financeiro", "financeiro@demo.kedu.local", "Financeiro demonstrativo"],
] as const)
  await sql.run("INSERT OR IGNORE INTO users VALUES(?,?,?,?,?)", "u" + i, name, email, role, hash(process.env.DEMO_PASSWORD || "Kedu-demo-2026!"));
for (const demand of await sql.all("SELECT id,data FROM demands"))
  await saveTerms(demand.id, JSON.parse(demand.data));
}
