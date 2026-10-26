const states:Record<string,string>={matches:"Confere",review:"Conferir leitura",different:"Divergência",missing:"Dado não localizado",ambiguous:"Pedido ambíguo",corrected:"Corrigido na nova versão"};
const order:Record<string,number>={different:0,ambiguous:1,missing:2,review:3,corrected:4,matches:5};
function display(key:string,value:string){
 if(['valor','cashbackValor'].includes(key))return value.split('; ').map(v=>/^\d+,\d{2}$/.test(v)?new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v.replace(',','.'))):v).join('; ');
 return value;
}
export function RequestComparison({rows}:{rows:any[]}){
 if(!rows?.length)return null;
 const different=rows.filter(r=>r.status==='different').length;
 const pending=rows.filter(r=>['missing','review','ambiguous'].includes(r.status)).length;
 return <section id="conferencia-preenchimento" className="panel request-comparison" aria-label="Conferência do preenchimento">
  <div className="comparison-heading"><div><h2>Como preencher e o que corrigir</h2><p className="muted">O pedido do GLPI é a referência. As divergências aparecem primeiro.</p></div><span className={"badge "+(different||pending?'warn':'ok')}>{different?`${different} divergência(s) · ${pending} item(ns) a conferir`:pending?`Conferência incompleta · ${pending} item(ns) pendente(s)`:'Campos comparados conferem'}</span></div>
  <div className="comparison-legend"><span className="legend-request">Azul: solicitado no GLPI</span><span className="legend-error">Vermelho: corrigir</span><span className="legend-review">Amarelo: conferir</span><span className="legend-match">Verde: confere</span></div>
  <div className="table-scroll"><table><thead><tr><th scope="col">Campo</th><th scope="col">No documento preenchido</th><th scope="col" className="requested-column">Como deve ser preenchido · GLPI</th><th scope="col">Correção / conferência</th></tr></thead><tbody>{[...rows].sort((a,b)=>(order[a.status]??9)-(order[b.status]??9)).map(r=><tr key={r.field} className={'comparison-row comparison-'+r.status}>
   <th scope="row">{r.label}</th><td><strong className={r.status==='different'?'comparison-found-error':''}>{r.found?display(r.field,r.found):'Não identificado no arquivo'}</strong>{r.source&&<small>{r.source}</small>}</td>
   <td className="requested-column"><strong>{display(r.field,r.expected)}</strong><small>Formulário e observações do chamado</small></td>
   <td><span className={'comparison-state state-'+r.status}>{states[r.status]}</span>{r.status==='different'&&<p>Substituir por <strong>{display(r.field,r.expected)}</strong>.</p>}{r.status==='missing'&&<p>Localize este campo no original ou complete a nova versão com o valor solicitado.</p>}{r.status==='review'&&<p>O texto lido coincide com o pedido. Confira o original antes de confirmar a leitura.</p>}{r.status==='ambiguous'&&<p>Confirme qual dos valores do próprio chamado deve ser usado.</p>}{r.status==='corrected'&&<p>Nova versão: <strong>{display(r.field,r.used)}</strong>. O original foi preservado.</p>}</td>
  </tr>)}</tbody></table></div>
 </section>;
}
