const states:Record<string,string>={matches:"Confere",review:"Conferir leitura",different:"Erro — corrigir",missing:"Não lido",ambiguous:"Pedido ambíguo",corrected:"Corrigido na nova versão",not_applicable:"Não se aplica"};
const order:Record<string,number>={different:0,ambiguous:1,missing:2,review:3,corrected:4,matches:5,not_applicable:6};
function missingMessage(row:any){return row.missingReason==="awaiting_version"?"O chamado foi atualizado. Aguardando obter e conferir os anexos da versão atual; isso não significa que o campo esteja ausente no documento.":row.missingReason==="not_sent"?`Envie o documento de origem: ${row.expectedDocument}.`:row.missingReason==="source_unidentified"?`Identifique o anexo que contém este campo. Fonte esperada: ${row.expectedDocument}.`:row.missingReason==="unreadable"?`O anexo foi enviado, mas a leitura falhou ou ficou parcial. Releia ou envie uma cópia legível de ${row.expectedDocument}.`:`O campo não foi encontrado no texto lido. Confira o original${row.expectedDocument?" — "+row.expectedDocument:""}.`;}
function notFound(row:any){return row.missingReason==="awaiting_version"?"Leitura da versão atual pendente":row.missingReason==="not_sent"?'Documento de origem não enviado':row.missingReason==="source_unidentified"?'Anexo de origem não identificado':row.missingReason==="unreadable"?'Leitura parcial ou falha do anexo':'Não localizado na extração';}
function display(key:string,value:string){
 if(['valor','cashbackValor','valorTotal','valorParcela'].includes(key))return value.split('; ').map(v=>/^\d+,\d{2}$/.test(v)?new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v.replace(',','.'))):v).join('; ');
 return value;
}
function action(r:any){
 if(r.message)return <p>{r.message}</p>;
 if(r.status==='not_applicable')return <p>{r.note}</p>;
 if(r.status==='different')return <p>Está <strong className="comparison-found-error">{display(r.field,r.found)}</strong>. Preencher com <strong>{display(r.field,r.expected)}</strong>.</p>;
 if(r.status==='missing')return <p>{missingMessage(r)}</p>;
 if(r.status==='review')return <p>{r.partlyMatches?"O documento traz mais de um valor e um deles confere com o GLPI. Confirme qual vale para este contrato.":r.matchesReference?"O valor coincide com o GLPI; falta confirmar a leitura no original.":"A leitura não é conclusiva. Confira o trecho no original antes de considerar o campo certo ou errado."}</p>;
 if(r.status==='ambiguous')return <p>O próprio chamado informa valores diferentes. Confirme qual deve ser usado.</p>;
 if(r.status==='corrected')return <p>Nova versão: <strong>{display(r.field,r.used)}</strong>. O original foi preservado.</p>;
 return null;
}
function Rows({rows}:{rows:any[]}){
 return <div className="table-scroll"><table><thead><tr><th scope="col">Campo</th><th scope="col">No documento</th><th scope="col" className="requested-column">Como deve ser preenchido · GLPI</th><th scope="col">Situação</th></tr></thead><tbody>{rows.map(r=><tr key={r.field} className={'comparison-row comparison-'+r.status}>
  <th scope="row">{r.label}</th>
  <td><strong className={r.status==='different'?'comparison-found-error':''}>{r.found?display(r.field,r.found):r.status==='not_applicable'?'Não consta neste tipo de documento':r.field==='clausulaCessao'?'Não encontrada':notFound(r)}</strong>{r.source&&<small>{r.source}</small>}</td>
  <td className="requested-column">{r.expectedEntities?.length>1?r.expectedEntities.map((entity:any)=><div key={entity.cnpj+entity.name}><strong>{entity.cnpj}</strong><small>{entity.name}</small></div>):<strong>{display(r.field,r.expected)}</strong>}</td>
  <td><span className={'comparison-state state-'+r.status}>{r.expectedEntities?.length>1?"Conferir empresas":r.status==="missing"&&r.missingReason==="awaiting_version"?"Atualização pendente":r.status==="missing"&&r.missingReason==="not_sent"?"Documento não enviado":states[r.status]}</span>{action(r)}</td>
 </tr>)}</tbody></table></div>;
}
export function RequestComparison({rows}:{rows:any[]}){
 if(!rows?.length)return null;
 const sorted=[...rows].sort((a,b)=>(order[a.status]??9)-(order[b.status]??9));
 const errors=sorted.filter(r=>r.status==='different'),pending=sorted.filter(r=>['missing','review','ambiguous'].includes(r.status)),done=sorted.filter(r=>['matches','corrected'].includes(r.status)),notApplicable=sorted.filter(r=>r.status==='not_applicable');
 return <section id="conferencia-preenchimento" className="panel request-comparison" aria-label="Conferência do preenchimento">
  <div className="comparison-heading"><div><h2>Documento × solicitação GLPI</h2><p className="muted">Cada campo pedido no chamado comparado com o que foi lido nos documentos.</p></div></div>
  <div className="comparison-counters" role="list">
   <span role="listitem" className="counter-error"><strong>{errors.length}</strong> com erro</span>
   <span role="listitem" className="counter-review"><strong>{pending.length}</strong> não lido(s) ou a conferir</span>
   <span role="listitem" className="counter-match"><strong>{done.length}</strong> confere(m)</span>
  </div>
  {!!errors.length&&<><h3>Erros: corrigir o preenchimento</h3><Rows rows={errors}/></>}
  {!!pending.length&&<><h3>Não lidos ou a conferir</h3><p className="muted">Não são erros: o portal não conseguiu ler ou confirmar estes campos nos documentos.</p><Rows rows={pending}/></>}
  {!!notApplicable.length&&<details className="pending-groups"><summary>Não se aplicam a este tipo de documento ({notApplicable.length})</summary><p className="muted">Informados no GLPI, mas não esperados nos documentos desta demanda. Não bloqueiam a conferência.</p><Rows rows={notApplicable}/></details>}
  {!!done.length&&<details className="pending-groups" open={!errors.length&&!pending.length}><summary>Campos que conferem ({done.length})</summary><Rows rows={done}/></details>}
 </section>;
}
