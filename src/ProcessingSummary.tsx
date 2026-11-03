import {useEffect,useState} from 'react';
import {summaryDocument} from './summary-document';
export function ProcessingSummary({stage,demands,api}:any){
 const [report,setReport]=useState<any>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const ids=demands.map((d:any)=>d.id).sort().join(',');
 const revisions=demands.map((d:any)=>JSON.stringify(d.processing)).join('|');
 useEffect(()=>{
  let active=true;setReport(null);setError('');setLoading(true);
  api('/processing/summary?'+new URLSearchParams({stage,ids})).then((result:any)=>{if(active)setReport(result);}).catch((e:any)=>{if(active)setError(e.message||'Não foi possível gerar o resumo.');}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[stage,ids,revisions]);
 const download=()=>{
  const url=URL.createObjectURL(new Blob([report.markdown],{type:'text/markdown;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=report.filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 const view=()=>{
  const url=URL.createObjectURL(new Blob([summaryDocument(report)],{type:'text/html;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
 };
 return <section className="panel" aria-label={'Resumo de '+stage}>
  <div className="panel-heading"><div><h2>Resumo — {stage.toLocaleLowerCase('pt-BR')}</h2><p>Demandas e pendências reunidas em um arquivo. Respeita os filtros da lista.</p></div>{report&&<button type="button" className="secondary" onClick={download}>Baixar resumo .md</button>}</div>
  {loading&&<p role="status">Gerando resumo atualizado…</p>}{error&&<p role="alert">{error}</p>}
  {report&&<button type="button" className="primary" onClick={view} aria-label={`Ver resumo de ${report.count} demandas — abre em outra aba`}>Ver resumo ({report.count} demandas) ↗</button>}
 </section>;
}
