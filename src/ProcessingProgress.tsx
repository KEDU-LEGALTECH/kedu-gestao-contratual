import {useEffect,useState} from 'react';
const labels:Record<string,string>={queued:'Na fila',running:'Em leitura',completed:'Leitura concluída',failed:'Com falha',waiting:'Não agendados',skipped:'Fora da leitura automática',unidentified:'Tipo a confirmar'};
export function ProcessingProgress({demands,api,detail=false,allowed=true}:{demands:{id:string}[];api:(path:string)=>Promise<any>;detail?:boolean;allowed?:boolean}){
 const ids=demands.map(d=>d.id).sort().join(',');
 const [progress,setProgress]=useState<any>(null),[error,setError]=useState('');
 useEffect(()=>{
  let active=true,inFlight=false;setProgress(null);setError('');
  if(!allowed)return()=>{active=false;};
  async function refresh(){
   if(inFlight)return;inFlight=true;
   try{const result=await api('/processing/progress?'+new URLSearchParams({ids}));if(active){setProgress(result);setError('');}}
   catch(e:any){if(active)setError(e.message||'Não foi possível consultar a fila de leitura.');}
   finally{inFlight=false;}
  }
  void refresh();const timer=setInterval(()=>{void refresh();},10000);
  return()=>{active=false;clearInterval(timer);};
 },[ids,allowed]);
 return <section className="panel processing-progress" aria-label="Andamento da leitura dos arquivos">
  <div className="panel-heading"><div><h2>Andamento da leitura</h2><p>{detail?'Arquivos desta demanda.':'Arquivos das demandas que atendem aos filtros da lista.'} Atualização automática a cada 10 segundos.</p></div></div>
  {!allowed&&<p role="status">Seu perfil não tem permissão para consultar os arquivos e seus dados de processamento. Acesse com um perfil autorizado ou solicite a verificação do acesso ao administrador.</p>}
  {allowed&&!progress&&!error&&<p role="status">Consultando processamento…</p>}
  {error&&<p role="alert">{error}{progress?' Os números abaixo são da última consulta bem-sucedida.':''}</p>}
  {progress&&<>
   <div className="processing-progress-counts">{Object.entries(labels).filter(([key])=>!['waiting','skipped','unidentified'].includes(key)||progress.counts[key]>0).map(([key,label])=><div className={'progress-count progress-'+key} key={key}><strong>{progress.counts[key]}</strong><span>{label}</span></div>)}</div>
   <p className="muted">{progress.total} arquivo(s). Contratos entram na leitura completa. Anexos de apoio ficam disponíveis na conversa do GLPI.</p>
   {progress.paused&&<p className="inline-warning">A leitura automática está pausada. Os arquivos na fila aguardam a retomada.</p>}
   {progress.attachmentsUnavailable>0&&<p className="inline-warning">Não foi possível obter a lista de anexos de {progress.attachmentsUnavailable} demanda(s). Esses arquivos não entram na contagem.</p>}
   {!progress.total&&<p>Nenhum anexo disponível neste recorte.</p>}
   {progress.files.some((f:any)=>f.state==='running')&&<p role="status">Em leitura: {progress.files.filter((f:any)=>f.state==='running').map((f:any)=>`${f.name}${f.page?' · página '+f.page:''}${f.targeted?' · releitura direcionada':''}`).join('; ')}</p>}
   <details open={detail}><summary>Ver arquivos e próximas tentativas</summary>
    <ul className="processing-file-list">{progress.files.map((f:any)=><li key={f.demandId+':'+f.documentId}>
     <strong>{f.name}</strong><span>{labels[f.state]}{!detail?' · '+f.demandId:''}</span>
     <p>{f.detail}{f.totalPages?` · ${f.completedPages}/${f.totalPages} páginas registradas como concluídas`:''}</p>
     {f.nextAttempt&&<p>Nova tentativa a partir de {new Date(f.nextAttempt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})} (Brasília), conforme a fila.</p>}
    </li>)}</ul>
   </details>
   <small className="muted">Última consulta: {new Date(progress.updatedAt).toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo'})} (Brasília).</small>
  </>}
 </section>;
}
