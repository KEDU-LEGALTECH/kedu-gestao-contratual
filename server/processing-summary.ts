type SummaryDemand={id:string;glpi_id?:string;school:string;type:string;status:string;issues:{label?:string;source?:string;message:string;found?:string;expected?:string}[]};
const line=(value:unknown)=>String(value??'').replace(/[\r\n]+/g,' ').replace(/([\\`*_[\]<>#])/g,'\\$1');
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
  for(const issue of demand.issues){
   lines.push(`- **${line(issue.label||'Pendência')}**${issue.source?` (${line(issue.source)})`:''}: ${line(issue.message)}`);
   if(issue.found)lines.push(`  - Encontrado: ${line(issue.found)}`);
   if(issue.expected)lines.push(`  - Esperado / correção indicada: ${line(issue.expected)}`);
  }
  if(!demand.issues.length)lines.push('- Nenhuma pendência detalhada registrada. Abra a demanda para atualizar a análise.');
  lines.push('');
 }
 if(!rows.length)lines.push('Nenhuma demanda encontrada neste recorte.');
 return {filename,markdown:lines.join('\n'),count:rows.length};
}
