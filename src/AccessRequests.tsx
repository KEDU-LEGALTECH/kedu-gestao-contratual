const roles = ["Consulta", "Solicitante", "Operação", "Jurídico", "Aprovador", "Risco", "Financeiro", "Administrador"];

/** Accounts requested on the login page, waiting for an administrator to choose the profile. */
export function AccessRequests({ users, api, action, busy }: any) {
  const pending = (users || []).filter((u: any) => u.pending);
  if (!pending.length) return null;
  return <div className="inline-warning">
   <h3>Pedidos de acesso ({pending.length})</h3>
   <p className="muted">Confira se a pessoa deve ter acesso antes de aprovar. O perfil define o que ela pode ver e fazer.</p>
   <ul className="simple-issues">{pending.map((u: any) => <li key={u.id}>
    <strong>{u.name}</strong> · {u.email}{u.requested_at && <small> · pedido em {new Date(u.requested_at).toLocaleString("pt-BR")}</small>}
    <form onSubmit={e => {
     e.preventDefault();
     const role = String(new FormData(e.currentTarget).get("role"));
     action(() => api(`/users/${u.id}/approve`, { role }), `Acesso de ${u.name} aprovado com perfil ${role}.`);
    }}>
     <label>Perfil<select name="role" defaultValue="Consulta">{roles.map(r => <option key={r}>{r}</option>)}</select></label>
     <button className="primary" disabled={busy}>Aprovar</button>{" "}
     <button type="button" className="text-button" disabled={busy}
      onClick={() => action(() => api(`/users/${u.id}/reject`, {}), `Pedido de ${u.name} recusado.`)}>Recusar</button>
    </form>
   </li>)}</ul>
  </div>;
}
