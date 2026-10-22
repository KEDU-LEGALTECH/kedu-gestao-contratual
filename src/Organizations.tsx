import { useState } from "react";
import {Search,ChevronRight,RefreshCw} from "lucide-react";
import "./organizations.css";
const kinds=["Todos","Aguardando classificação","Escola","Fornecedor","Outra organização"];
const names:Record<string,string>={Todos:"Todos",Escola:"Escolas",Fornecedor:"Fornecedores","Outra organização":"Outras organizações","Aguardando classificação":"Aguardando classificação"};
const searchable=(text:string)=>text.normalize("NFD").replace(/\p{Diacritic}/gu,"").toLowerCase();
export function Organizations({data,can,action,api,busy,onEdit,onDemands}:any) {
 const [category,setCategory]=useState("Todos"),[query,setQuery]=useState(""),[expanded,setExpanded]=useState<string|null>(null);
 const rows=data.organizations||data.schools||[];
 const filtered=rows.filter((o:any)=>{
  if(category!=="Todos" && o.organization_kind!==category)return false;
  const q=searchable(query.trim()),digits=q.replace(/\D/g,"");
  return !q || searchable([o.name,o.legal_name,o.cnpj].join(" ")).includes(q) || (/^[\d.\/\s-]+$/.test(q) && digits && o.cnpj.replace(/\D/g,"").includes(digits));
 });
 return <>
  <section className="panel organization-filters" aria-label="Buscar e filtrar organizações">
   <div className="organization-search-row"><div className="search"><Search size={18}/><input aria-label="Buscar organização por nome ou CNPJ" placeholder="Buscar por nome ou CNPJ" value={query} onChange={e=>setQuery(e.target.value)}/></div>
    {can("schools") && <button className="secondary" disabled={busy} onClick={()=>action(()=>api("/glpi/schools/import",{}),"Cadastros dos chamados atualizados. Confira a categoria dos novos registros.")}><RefreshCw size={15}/> Atualizar do GLPI</button>}
   </div>
   <div className="organization-categories" role="group" aria-label="Categoria da organização">{kinds.map(kind=><button type="button" key={kind} className={category===kind?"organization-category active":"organization-category"} aria-pressed={category===kind} onClick={()=>setCategory(kind)}>{names[kind]}<span>{kind==="Todos"?rows.length:rows.filter((o:any)=>o.organization_kind===kind).length}</span></button>)}</div>
   <p className="muted">Cadastros do GLPI entram como “Aguardando classificação”. Confira os documentos antes de definir a categoria.</p>
  </section>
  <section className="panel organization-list" aria-label="Cadastros de organizações">
   <div className="organization-list-heading"><h2>Cadastros</h2><span className="muted" role="status">{filtered.length} {filtered.length===1?"cadastro encontrado":"cadastros encontrados"}</span></div>
   {!filtered.length && <p className="organization-empty">Nenhum cadastro encontrado. Altere a busca ou a categoria selecionada.</p>}
   {filtered.map((o:any)=>{
    const count=data.demands.filter((d:any)=>d.school_id===o.id).length,pending=o.organization_kind==="Aguardando classificação",open=expanded===o.id;
    return <article key={o.id} className="organization-item">
     <div className="organization-row"><div className="organization-identity"><h3>{o.name}</h3><p>{o.cnpj}{o.glpi_ticket && <span> · GLPI #{o.glpi_ticket}</span>}</p></div><span className={"badge "+(pending?"warn":"ok")}>{o.organization_kind}</span>
      <div className="organization-actions"><button className="text-button" onClick={()=>onDemands(o)}>{count} {count===1?"demanda":"demandas"}<ChevronRight size={14}/></button>
       <button className="secondary" aria-expanded={open} aria-controls={"organization-"+o.id} onClick={()=>setExpanded(open?null:o.id)}>{open?"Fechar":pending && can("schools")?"Classificar":"Ver cadastro"}</button></div>
     </div>
     {open && <div className="organization-details" id={"organization-"+o.id}>
      <dl><div><dt>Razão social</dt><dd>{o.legal_name||o.name}</dd></div><div><dt>Endereço</dt><dd>{o.address||"Não informado"}</dd></div><div><dt>Contato</dt><dd>{o.contact||"Não informado"}</dd></div><div><dt>Origem</dt><dd>{o.glpi_ticket?`Chamado GLPI #${o.glpi_ticket}`:"Cadastro manual"}</dd></div></dl>
      {o.classification_note && <p className="muted">Última classificação: {o.classification_note}</p>}
      {can("schools") && <button className="text-button" onClick={()=>onEdit(o)}>Editar cadastro e representantes</button>}
      {can("schools") && o.classification_version>0 && <form className="organization-classification" key={o.id+":"+o.classification_version} onSubmit={event=>{
       event.preventDefault();const form=new FormData(event.currentTarget);
       action(()=>api(`/organizations/${o.id}/classification`,{kind:form.get("kind"),note:form.get("note"),expected_version:o.classification_version,attested:form.get("attested")==="on"},"PUT"),"Categoria confirmada. Cadastro atualizado nesta lista.");
      }}><h3>{pending?"Confirmar categoria":"Reclassificar organização"}</h3><div className="form-grid"><label>Categoria<select name="kind" required defaultValue={pending?"":o.organization_kind}><option value="">Selecione após conferir</option><option>Escola</option><option>Fornecedor</option><option>Outra organização</option></select></label><label>Referência e justificativa<textarea name="note" required minLength={10} maxLength={500} placeholder="Indique o documento ou informação que confirma a categoria."/></label></div><label className="organization-attestation"><input type="checkbox" name="attested" required/> Conferi a categoria no chamado e nos documentos disponíveis.</label><button className="primary" disabled={busy}>Confirmar classificação</button></form>}
     </div>}
    </article>;
   })}
  </section>
 </>;
}
