type Evidence={fileName?:string;page?:number;excerpt?:string};
type SummaryComparison={field:string;label?:string;status:string;found?:string;expected?:string;evidence?:Evidence[]};
type SummaryDemand={id:string;glpi_id?:string;school:string;type:string;status:string;issues:{field?:string;label?:string;source?:string;message:string;found?:string;expected?:string;pendingReason?:{code:string;label:string;action:string}}[];comparisons?:SummaryComparison[]};
const line=(value:unknown)=>String(value??'').replace(/[\r\n]+/g,' ').replace(/([\\`*_[\]<>#])/g,'\\$1');
/** Where the wrong value is printed: file, page and the excerpt read from it. */
const where=(evidence:Evidence[]=[])=>evidence.map(e=>[e.fileName&&`arquivo "${line(e.fileName)}"`,e.page&&`página ${e.page}`,e.excerpt&&`trecho: “${line(e.excerpt).slice(0,240)}”`].filter(Boolean).join(', ')).filter(Boolean);
export function processingSummaryReport(stage:string,demands:SummaryDemand[],date=new Date()) {
 const analysis=stage==='Aguardando análise';
 const filename=analysis?'Pendencias_de_analise.md':'Pendencias_de_correcao.md';
 const rows=demands.filter(d=>d.status===stage);
 const lines=[`# ${analysis?'Pendências de leitura e conferência':'Pendências de correção'}`,'',`Gerado em ${date.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})} (Brasília). ${rows.length} demanda(s).`,
  'Escopo: demandas da etapa selecionada que atendem aos filtros atuais.',
  analysis?'Os avisos não comprovam erro no documento. Leituras inconclusivas precisam de conferência.':'Há divergência identificada entre o documento e o GLPI. Outras pendências da mesma demanda aparecem separadamente abaixo.',
  'Nenhuma aprovação ou alteração é realizada ao gerar este resumo.',''];
 for(const demand of rows){
  lines.push(`## ${line(demand.school)} — GLPI #${line(demand.glpi_id||'não vinculado')}`,`${line(demand.id)} · ${line(demand.type)} · ${stage}`,'');
  const errors=(demand.comparisons||[]).filter(c=>c.status==='different');
  if(errors.length){
   lines.push('### Erros e onde corrigir','');
   for(const error of errors){
    lines.push(`- **${line(error.label||error.field)}**: no documento está “${line(error.found)}”; o correto, conforme o chamado, é “${line(error.expected)}”.`);
    for(const place of where(error.evidence))lines.push(`  - Onde: ${place}`);
   }
   lines.push('','### Demais pendências','');
  }
  for(const issue of demand.issues.filter(i=>!errors.some(e=>e.field===i.field))){
   lines.push(`- **${line(issue.label||'Pendência')}**${issue.source?` (${line(issue.source)})`:''}: ${line(issue.message)}`);
   if(issue.pendingReason)lines.push(`  - Motivo: ${line(issue.pendingReason.label)}`,`  - Próxima ação: ${line(issue.pendingReason.action)}`);
   if(issue.found)lines.push(`  - Encontrado: ${line(issue.found)}`);
   if(issue.expected)lines.push(`  - Esperado / correção indicada: ${line(issue.expected)}`);
  }
  if(!demand.issues.length&&!errors.length)lines.push('- Nenhuma pendência detalhada registrada. Abra a demanda para atualizar a análise.');
  lines.push('');
 }
 if(!rows.length)lines.push('Nenhuma demanda encontrada neste recorte.');
 return {filename,markdown:lines.join('\n'),count:rows.length,stage,generatedAt:date.toISOString(),demands:rows.map(({id,glpi_id,school,type,status,issues})=>({id,glpi_id,school,type,status,issues}))};
}
