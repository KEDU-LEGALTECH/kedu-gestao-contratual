import { all, one, run, db, audit } from "./db.js";

const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
/** Administrative maintenance only: no HTTP endpoint and never run during startup.
 * Requires a prior consistent backup and DEMO_SEED=false. Aborts on mixed dependencies. */
export function cleanupDemoData() {
  if (process.env.DEMO_SEED === "true") throw Error("Desative DEMO_SEED antes da limpeza.");
  db.exec("BEGIN IMMEDIATE");
  try {
    const schoolIds: string[] = [];
    const demandIds: string[] = [];
    const contractIds: string[] = [];
    for (let i = 0; i < 8; i++) {
      const school = one("SELECT * FROM schools WHERE id=?", "s" + i);
      if (!school) continue;
      if (school.cnpj !== `${10 + i}.234.567/0001-90` || school.address !== "Fortaleza, CE • Dados fictícios" || school.contact !== "contato@escola.example")
        throw Error("Cadastro demonstrativo foi alterado; revise manualmente antes de excluir: " + school.id);
      if (one("SELECT school_id FROM school_glpi_origins WHERE school_id=?", school.id) || one("SELECT school_id FROM school_glpi_sources WHERE school_id=?", school.id))
        throw Error("Escola demonstrativa vinculada a fonte real GLPI; limpeza interrompida.");
      const demands = all("SELECT * FROM demands WHERE school_id=?", school.id);
      const expected = `KD-${String(i + 1).padStart(4, "0")}`;
      if (demands.some(d => d.id !== expected || d.glpi_id !== String(2840 + i) || d.type !== "Contrato de garantia" || d.contract_id !== "c" + i || JSON.parse(d.data).cnpj !== school.cnpj))
        throw Error("Escola fictícia possui demanda fora da carga original; limpeza interrompida.");
      if (one("SELECT external_id FROM glpi_tickets WHERE mode='real' AND demand_id=?", expected))
        throw Error("Demanda da carga original vinculada ao GLPI real; limpeza interrompida.");
      const contracts = all("SELECT * FROM contracts WHERE school_id=?", school.id);
      if (contracts.some(c => c.id !== "c" + i || c.parent_id))
        throw Error("Escola fictícia possui instrumentos adicionais; revise antes de excluir.");
      schoolIds.push(school.id);
      demandIds.push(...demands.map(d => d.id));
      contractIds.push(...contracts.map(c => c.id));
    }
    function temp(name: string, values: string[]) {
      db.exec(`CREATE TEMP TABLE IF NOT EXISTS ${quote(name)}(id TEXT PRIMARY KEY); DELETE FROM ${quote(name)};`);
      for (const value of values) run(`INSERT INTO ${quote(name)} VALUES(?)`, value);
    }
    temp("cleanup_schools", schoolIds);
    temp("cleanup_demands", demandIds);
    temp("cleanup_contracts", contractIds);
    temp("cleanup_documents", all("SELECT id FROM documents WHERE demand_id IN (SELECT id FROM cleanup_demands)").map(d => d.id));
    temp("cleanup_versions", all("SELECT c.version_id id FROM template_catalog c WHERE c.demonstration=1 AND NOT EXISTS(SELECT 1 FROM template_sources s WHERE s.version_id=c.version_id)").map(v => v.id));
    temp("cleanup_templates", all("SELECT DISTINCT template_id id FROM template_versions WHERE id IN(SELECT id FROM cleanup_versions)").map(t => t.id));
    if (one("SELECT id FROM contracts WHERE parent_id IN(SELECT id FROM cleanup_contracts) AND id NOT IN(SELECT id FROM cleanup_contracts)"))
      throw Error("Contrato externo depende da matriz fictícia; limpeza interrompida.");
    if (one("SELECT id FROM demands WHERE id NOT IN(SELECT id FROM cleanup_demands) AND (contract_id IN(SELECT id FROM cleanup_contracts) OR json_extract(data,'$.matriz') IN(SELECT id FROM cleanup_contracts))"))
      throw Error("Demanda externa depende de contrato fictício; limpeza interrompida.");
    if (one("SELECT id FROM documents WHERE template_version IN(SELECT id FROM cleanup_versions) AND id NOT IN(SELECT id FROM cleanup_documents)") ||
        one("SELECT id FROM template_previews WHERE template_version IN(SELECT id FROM cleanup_versions) AND demand_id NOT IN(SELECT id FROM cleanup_demands)"))
      throw Error("Modelo demonstrativo usado fora da carga fictícia; limpeza interrompida.");
    // These delete guards are restored in the SAME transaction; rollback also restores them.
    // Only rows proven to belong to the seed or demo tickets are removed below.
    const guards = all("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name IN('no_delete_baseline','no_delete_signed_history','no_delete_history_confirmation','no_delete_glpi_version')");
    for (const guard of guards) db.exec(`DROP TRIGGER ${quote(guard.name)}`);
    const docs = "(SELECT id FROM cleanup_documents)";
    run(`DELETE FROM human_issues WHERE check_id IN(SELECT id FROM human_checks WHERE document_id IN${docs})`);
    for (const table of ["signature_records", "human_checks", "approvals", "reviews"])
      run(`DELETE FROM ${quote(table)} WHERE document_id IN${docs}`);
    run("DELETE FROM template_previews WHERE demand_id IN(SELECT id FROM cleanup_demands)");
    run("DELETE FROM documents WHERE id IN(SELECT id FROM cleanup_documents)");
    for (const table of ["evidence_files", "commercial_terms", "cashback_values", "case_details", "demand_baselines", "audit"])
      run(`DELETE FROM ${quote(table)} WHERE demand_id IN(SELECT id FROM cleanup_demands)`);
    const demoTickets = one("SELECT COUNT(*) n FROM glpi_tickets WHERE mode='demo'").n;
    run("DELETE FROM glpi_ticket_versions WHERE external_id IN(SELECT external_id FROM glpi_tickets WHERE mode='demo')");
    run("DELETE FROM glpi_tickets WHERE mode='demo'");
    run("DELETE FROM demands WHERE id IN(SELECT id FROM cleanup_demands)");
    for (const table of ["history_confirmations", "signed_history"])
      run(`DELETE FROM ${quote(table)} WHERE matrix_id IN(SELECT id FROM cleanup_contracts)`);
    run("DELETE FROM contracts WHERE id IN(SELECT id FROM cleanup_contracts)");
    run("DELETE FROM representatives WHERE school_id IN(SELECT id FROM cleanup_schools)");
    run("DELETE FROM schools WHERE id IN(SELECT id FROM cleanup_schools)");
    const versions = one("SELECT COUNT(*) n FROM cleanup_versions").n;
    run("DELETE FROM inactive_template_versions WHERE version_id IN(SELECT id FROM cleanup_versions)");
    run("DELETE FROM template_catalog WHERE version_id IN(SELECT id FROM cleanup_versions)");
    run("DELETE FROM template_versions WHERE id IN(SELECT id FROM cleanup_versions)");
    run("DELETE FROM templates WHERE id IN(SELECT id FROM cleanup_templates) AND NOT EXISTS(SELECT 1 FROM template_versions v WHERE v.template_id=templates.id)");
    run("DELETE FROM sync_logs WHERE message LIKE 'Demonstração:%'");
    for (const guard of guards) db.exec(guard.sql);
    let usersRemoved = 0;
    let localAccountsKept = 0;
    const tables = all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
    for (const user of all("SELECT * FROM users WHERE email LIKE '%@demo.kedu.local'")) {
      let referenced = user.role === "Administrador";
      for (const table of tables) {
        if (table.name === "sessions") continue;
        for (const fk of all(`PRAGMA foreign_key_list(${quote(table.name)})`).filter(f => f.table === "users"))
          if (one(`SELECT 1 present FROM ${quote(table.name)} WHERE ${quote(fk.from)}=? LIMIT 1`, user.id)) referenced = true;
      }
      if (referenced) {
        run("UPDATE users SET name=? WHERE id=?", "Conta local — " + user.role, user.id);
        localAccountsKept++;
      } else {
        run("DELETE FROM sessions WHERE user_id=?", user.id);
        run("DELETE FROM users WHERE id=?", user.id);
        usersRemoved++;
      }
    }
    run("INSERT INTO settings VALUES('demoDisabled','true') ON CONFLICT(key) DO UPDATE SET value='true'");
    if (all("PRAGMA foreign_key_check").length) throw Error("Falha de integridade: limpeza revertida.");
    const summary = { schoolsRemoved: schoolIds.length, demandsRemoved: demandIds.length, contractsRemoved: contractIds.length, templateVersionsRemoved: versions, demoTicketsRemoved: demoTickets, usersRemoved, localAccountsKept };
    audit(null, null, "Limpeza administrativa da demonstração com backup prévio: " + JSON.stringify(summary));
    db.exec("COMMIT");
    return summary;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
