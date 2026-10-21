import { useState } from "react";
export function Organizations({ data, can, action, api, busy }: any) {
  const [tab, setTab] = useState("Aguardando classificação");
  const rows = data.organizations || [];
  return <>
    <section className="panel">
      <p>Os chamados do GLPI podem citar escolas, fornecedores e outras empresas. Confira o chamado e os documentos antes de confirmar a categoria. Nomes e CNPJs não determinam automaticamente o tipo.</p>
      {can("schools") && <button className="secondary" disabled={busy} onClick={() => action(() => api("/glpi/schools/import", {}), "Organizações dos chamados atualizadas. Os novos cadastros aguardam classificação.")}>Atualizar organizações dos chamados</button>}
      <div className="form-grid">
        {["Aguardando classificação", "Escola", "Fornecedor", "Outra organização"].map(kind => <button key={kind} className={tab === kind ? "primary" : "secondary"} onClick={() => setTab(kind)}>{kind} ({rows.filter((o: any) => o.organization_kind === kind).length})</button>)}
      </div>
    </section>
    <div className="school-grid">
      {rows.filter((o: any) => o.organization_kind === tab).map((o: any) => <section className="panel" key={o.id}>
        <h2>{o.name}</h2><p>{o.cnpj}</p><p className="muted">Origem: GLPI #{o.glpi_ticket || "—"} • {o.organization_kind}</p>
        {o.classification_note && <p>{o.classification_note}</p>}
        {can("schools") && o.classification_version > 0 && <form key={o.classification_version} onSubmit={event => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          action(() => api(`/organizations/${o.id}/classification`, { kind: form.get("kind"), note: form.get("note"), expected_version: o.classification_version, attested: form.get("attested") === "on" }, "PUT"), "Classificação confirmada. Apenas escolas confirmadas aparecem na seção Escolas.");
        }}>
          <label>Categoria<select name="kind" required defaultValue={o.organization_kind === "Aguardando classificação" ? "" : o.organization_kind}><option value="">Selecione após conferir</option><option>Escola</option><option>Fornecedor</option><option>Outra organização</option></select></label>
          <label>Referência e justificativa<textarea name="note" required minLength={10} maxLength={500} placeholder="Indique o documento ou informação conferida no chamado." /></label>
          <label><input type="checkbox" name="attested" required /> Conferi a categoria no chamado e na documentação disponível.</label>
          <button className="primary" disabled={busy}>Confirmar classificação</button>
        </form>}
      </section>)}
    </div>
    {!rows.some((o: any) => o.organization_kind === tab) && <p className="muted">Nenhum cadastro nesta categoria.</p>}
  </>;
}
