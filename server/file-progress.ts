import {needsReadingRecovery} from './reading-recovery-policy.js';
/** Exclusive file counts: a queued retry is not counted a second time as a failure. */
export function fileProgress(doc:any,file:any,queue:any,active:any,targeted=false,excluded?:'support'|'superseded'|'unknown',needsWork?:boolean){
 let reading:any={};try{reading=JSON.parse(file?.extracted||'{}');}catch{}
 if(excluded)return {documentId:String(doc.id),name:file?.name||doc.name||'Anexo',state:excluded==='unknown'?'unidentified':'skipped',
  detail:excluded==='unknown'?'Confira o tipo do arquivo na conversa do GLPI. A identificação inicial não confirmou um contrato.':excluded==='support'?'Anexo de apoio disponível na conversa do GLPI.':'Versão substituída, disponível na conversa do GLPI.'};
 const recovery=needsWork??needsReadingRecovery(file);
 const state=active?.documentId===String(doc.id)?'running':
  (recovery||targeted)&&['queued','retry','running'].includes(queue?.state)?'queued':
  !recovery?'completed':file?.problem||reading.problem||reading.incomplete||queue?.state==='exhausted'?'failed':'waiting';
 return {documentId:String(doc.id),name:file?.name||doc.name||'Anexo',state,
  targeted:state==='running'?!!active.targeted:targeted,
  page:state==='running'?active.page:undefined,
  completedPages:reading.completedPages?.length||(!recovery?reading.pages||0:0),totalPages:reading.pages,
  detail:state==='running'?(active.targeted?'Relendo página com campos pendentes':'Obtendo ou lendo o arquivo'):
   state==='queued'?(queue.state==='retry'?'Nova tentativa programada':'Aguardando a vez na fila'):
   state==='failed'?(reading.incomplete?'Leitura parcial: há páginas pendentes':file?.problem||reading.problem||'Tentativas automáticas esgotadas'):
   state==='waiting'?'Ainda não há tentativa automática agendada':'Leitura concluída; a conferência dos dados é uma etapa separada',
  nextAttempt:state==='queued'&&queue.state==='retry'?new Date(queue.available_at).toISOString():undefined,
 };
}
