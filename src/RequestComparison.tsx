import {readingBlockers} from '../server/processing-status';
import {FieldEvidence} from './FieldEvidence';
import {pendingReason} from '../shared/pending-reason';
const states:Record<string,string>={matches:"Confere",review:"Conferir leitura",different:"Erro — corrigir",missing:"Não lido",ambiguous:"Pedido ambíguo",corrected:"Corrigido na nova versão",not_applicable:"Não se aplica"};
const order:Record<string,number>={different:0,ambiguous:1,missing:2,review:3,corrected:4,matches:5,not_applicable:6};
function missingMessage(row:any){if(row.missingReason==='not_printed')return 'O arquivo foi conferido visualmente e este dado não está informado. Solicite um documento com a informação; não é falha de OCR.';return row.missingReason==="awaiting_version"?"O chamado foi atualizado. Aguardando obter e conferir os anexos da versão atual; isso não significa que o campo esteja ausente no documento.":row.missingReason==="not_sent"?`Envie o documento de origem: ${row.expectedDocument}.`:row.missingReason==="source_unidentified"?`Identifique o anexo que contém este campo. Fonte esperada: ${row.expectedDocument}.`:row.missingReason==="unreadable"?`O anexo foi enviado, mas a leitura falhou ou ficou parcial. Releia ou envie uma cópia legível de ${row.expectedDocument}.`:`O campo não foi encontrado no texto lido. Confira o original${row.expectedDocument?" — "+row.expectedDocument:""}.`;}
/** A person decides here what the reader cannot. The note goes to the audit log; nothing is approved automatically. */
function ResolutionForm({title,hint,initial,withValue,busy,submit}:{title:string;hint:string;initial?:string;withValue?:boolean;busy?:boolean;submit:(note:string,value?:string)=>void}){
 return <form className="pending-groups" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);submit(String(f.get('note')||''),withValue?String(f.get('value')||''):undefined);}}>
  <p className="muted">{hint}</p>
  {withValue&&<label>Valor correto<input name="value" required maxLength={500} defaultValue={initial}/></label>}
  <label>Justificativa<textarea name="note" required minLength={5} maxLength={1000} rows={2}/></label>
  <button className="secondary" disabled={busy}>{title}</button>
 </form>;
}
function notFound(row:any){if(['download_pending','download_failed','partial','read_failed','coverage_partial','value_unassociated'].includes(row.missingReason))return pendingReason({...row,status:'missing'})!.label;if(row.missingReason==='not_printed')return 'Dado não informado no documento';return row.missingReason==="awaiting_version"?"Leitura da versão atual pendente":row.missingReason==="not_sent"?'Documento de origem não enviado':row.missingReason==="source_unidentified"?'Anexo de origem não identificado':row.missingReason==="unreadable"?'Leitura parcial ou falha do anexo':'Não localizado na extração';}
function display(key:string,value:string){
 if(['valor','cashbackValor','valorTotal','valorParcela'].includes(key))return value.split('; ').map(v=>/^\d+,\d{2}$/.test(v)?new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v.replace(',','.'))):v).join('; ');
 return value;
}
function action(r:any){
 const pending=pendingReason(r);
 if(pending)return <><p>{r.message||r.reviewReason?.message||pending.label}</p><p><strong>Próxima ação:</strong> {pending.action}</p></>;
 if(r.message)return <p>{r.message}</p>;
 if(r.status==='not_applicable')return <p>{r.note}</p>;
 if(r.status==='different')return <p>Está <strong className="comparison-found-error">{display(r.field,r.found)}</strong>. Preencher com <strong>{display(r.field,r.expected)}</strong>.</p>;
 if(r.status==='missing')return <p>{missingMessage(r)}</p>;
 if(r.status==='review'&&r.reviewReason?.message)return <p>{r.reviewReason.message}</p>;
 if(r.status==='review')return <p>{r.partlyMatches?"O documento traz mais de um valor e um deles confere com o GLPI. Confirme qual vale para este contrato.":r.matchesReference?"O valor coincide com o GLPI; falta confirmar a leitura no original.":"A leitura não é conclusiva. Confira o trecho no original antes de considerar o campo certo ou errado."}</p>;
 if(r.status==='ambiguous')return <p>O próprio chamado informa valores diferentes. Confirme qual deve ser usado.</p>;
 if(r.status==='corrected')return <p>Nova versão: <strong>{display(r.field,r.used)}</strong>. O original foi preservado.</p>;
 return null;
}
function Rows({rows,did,resolve,busy}:{rows:any[];did?:string;resolve?:Resolve;busy?:boolean}){
 return <div className="table-scroll"><table><thead><tr><th scope="col">Campo</th><th scope="col">No documento</th><th scope="col" className="requested-column">Como deve ser preenchido · GLPI</th><th scope="col">Situação</th></tr></thead><tbody>{rows.map(r=><tr key={r.field} className={'comparison-row comparison-'+r.status}>
  <th scope="row">{r.label}</th>
  <td><strong className={r.status==='different'?'comparison-found-error':''}>{r.found?display(r.field,r.found):r.status==='not_applicable'?'Não consta neste tipo de documento':r.field==='clausulaCessao'?'Não encontrada':notFound(r)}</strong>{!r.evidence?.length&&r.source&&<small>{r.source}</small>}<FieldEvidence evidence={r.evidence} found={r.found} did={did}/></td>
  <td className="requested-column">{r.expectedEntities?.length>1?r.expectedEntities.map((entity:any)=><div key={entity.cnpj+entity.name}><strong>{entity.cnpj}</strong><small>{entity.name}</small></div>):<strong>{display(r.field,r.expected)}</strong>}{r.referenceCorrection&&<small>Corrigido na conversa do chamado{r.referenceCorrection.date?` em ${r.referenceCorrection.date}`:''}. Valor anterior: {r.referenceCorrection.previous.join('; ')}</small>}{r.referenceResolution&&<small>Definido por decisão registrada. No GLPI: {r.referenceResolution.original}. Justificativa: {r.referenceResolution.note}</small>}</td>
  <td><span className={'comparison-state state-'+r.status}>{r.expectedEntities?.length>1?"Conferir empresas":pendingReason(r)?.label??(r.status==="missing"&&r.missingReason==="awaiting_version"?"Atualização pendente":r.status==="missing"&&r.missingReason==="not_sent"?"Documento não enviado":r.missingReason==="not_printed"?"Dado não informado":states[r.status])}</span>{action(r)}{r.status==='ambiguous'&&resolve&&<ResolutionForm withValue busy={busy} initial={r.expected?.includes(';')?'':r.expected} title="Registrar referência" hint="Confira o chamado no GLPI e informe o valor que vale para esta demanda. Se o GLPI for corrigido, esta decisão deixa de valer." submit={(note,value)=>resolve('reference',r.field,note,value)}/>}</td>
 </tr>)}</tbody></table></div>;
}
type Resolve=(kind:string,field:string,note:string,value?:string)=>void;
export function RequestComparison({rows,did,issues=[],resolve,busy}:{rows:any[];did?:string;issues?:any[];resolve?:Resolve;busy?:boolean}){
 if(!rows?.length)return null;
 const blockers=readingBlockers(issues) as any[];
 const sorted=[...rows].sort((a,b)=>(order[a.status]??9)-(order[b.status]??9));
 const errors=sorted.filter(r=>r.status==='different'),pending=sorted.filter(r=>['missing','review','ambiguous'].includes(r.status)),done=sorted.filter(r=>['matches','corrected'].includes(r.status)),notApplicable=sorted.filter(r=>r.status==='not_applicable');
 return <section id="conferencia-preenchimento" className="panel request-comparison" aria-label="Conferência do preenchimento">
  <div className="comparison-heading"><div><h2>Documento × solicitação GLPI</h2><p className="muted">Cada campo pedido no chamado comparado com o que foi lido nos documentos.</p></div></div>
  <div className="comparison-counters" role="list">
   <span role="listitem" className="counter-error"><strong>{errors.length}</strong> com erro</span>
   <span role="listitem" className="counter-review"><strong>{pending.length+blockers.length}</strong> pendente(s) de conferência</span>
   <span role="listitem" className="counter-match"><strong>{done.length}</strong> confere(m)</span>
  </div>
  {!!blockers.length&&<div className="inline-warning"><h3>Outras pendências que mantêm a demanda em análise ({blockers.length})</h3><ul>{blockers.map((i:any)=><li key={i.field}><strong>{i.label}</strong><p>{i.message}</p>{i.source&&<small>Arquivo: {i.source}</small>}{resolve&&i.field.startsWith('review:validation:')&&<ResolutionForm busy={busy} title="Registrar conferência" hint="Depois de conferir os originais, registre por que este achado é aceitável. Se os valores mudarem, ele volta a ficar pendente." submit={note=>resolve('validation',i.field.slice('review:validation:'.length),note)}/>}</li>)}</ul></div>}
  {!!errors.length&&<><h3>Erros: corrigir o preenchimento</h3><Rows did={did} rows={errors}/></>}
  {!!pending.length&&<><h3>Campos pendentes de conferência</h3><p className="muted">Podem ser dúvidas de leitura, dados não informados ou documentos de origem ainda necessários. Veja o motivo em cada linha.</p><Rows did={did} rows={pending} resolve={resolve} busy={busy}/></>}
  {!!notApplicable.length&&<details className="pending-groups"><summary>Não se aplicam a este tipo de documento ({notApplicable.length})</summary><p className="muted">Informados no GLPI, mas não esperados nos documentos desta demanda. Não bloqueiam a conferência.</p><Rows did={did} rows={notApplicable}/></details>}
  {!!done.length&&<details className="pending-groups" open={!errors.length&&!pending.length}><summary>Campos que conferem ({done.length})</summary><Rows did={did} rows={done}/></details>}
 </section>;
}
