import {fieldLabels} from '../shared/official-fields.js';
export function doclingBatchReport(report:any,attempts:any[]=[]){
 const stages=['Aguardando análise','Aguardando correção','Sem erros'];
 const status:Record<string,string>={missing:'Não localizado',review:'A conferir',matches:'Confere',different:'Divergência',ambiguous:'Pedido ambíguo'};
 const safe=(v:unknown)=>String(v??'').replace(/[\r\n]+/g,' ').replace(/[|]/g,'/');
 const lines=['# Resultado do lote Docling','',`Lote iniciado em ${new Date(report.at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})} (Brasília).`,'',
 `${report.examined} demandas examinadas; ${report.eligibleDemands} com PDFs elegíveis.`,
 `${report.eligibleFiles} arquivos, ${report.pages} páginas processadas (${report.uniquePages} leituras únicas; originais idênticos foram reaproveitados).`,
 `Páginas com falha após as novas tentativas: ${report.failedPagesAfterRetry??report.failedPages}.`,'',
 '## Etapas das demandas','', '| Etapa | Antes | Depois |','| --- | ---: | ---: |',...stages.map(s=>`| ${s} | ${report.before.stages[s]||0} | ${report.after.stages[s]||0} |`),'',
 '## Resultado dos campos','', '| Situação | Antes | Depois |','| --- | ---: | ---: |',...['missing','review','matches','different','ambiguous'].map(s=>`| ${status[s]} | ${report.before.fields[s]||0} | ${report.after.fields[s]||0} |`),'',
 'A redução de campos não localizados não significa, por si só, que a demanda está sem erros. As demais pendências continuam sendo verificadas.','',
 '## Alterações por chamado',''];
 for(const c of report.changes)lines.push(`- **GLPI #${safe(c.glpi)} · ${safe((fieldLabels as Record<string,string>)[c.field]||c.field)}**: ${safe(status[c.from]||c.from)} → ${safe(status[c.to]||c.to)}. Valor lido: ${safe(c.found||'não localizado')}.`);
 if(!report.changes.length)lines.push('Nenhum campo comparado mudou neste lote.');
 lines.push('','## Aplicação na base','',`${report.applied.length} arquivos atualizados; ${report.notApplied.length} preservados por alteração ou confirmação ocorrida durante o lote.`);
 for(const item of report.notApplied)lines.push(`- ${safe(item.id)}: ${safe(item.reason)}.`);
 if(attempts.length)lines.push('',`Maior memória registrada do leitor: ${Math.max(...attempts.map(a=>a.peakMemoryMB||0))} MB.`);
 lines.push('','## Documentos que não usam este complemento','',
 'Fotos e páginas sem texto nativo continuam dependendo do OCR. Contrapropostas, relatórios e simulações que exigem decisões não tiveram condições adotadas automaticamente.');
 for(const item of report.skipped)lines.push(`- ${safe(item.demand)} · ${safe(item.file)}: ${safe(item.reason)}.`);
 return lines.join('\n')+'\n';
}
