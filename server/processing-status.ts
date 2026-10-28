type Comparison={status:string;readingPending?:boolean};
/** An unreadable value is not evidence of an incorrect document. */
export function processingStatus(issues:{field:string}[],comparisons:Comparison[]) {
 if(comparisons.some(c=>c.status==='different'&&!c.readingPending))return 'Aguardando correção';
 if(!comparisons.length||comparisons.some(c=>['missing','review','ambiguous'].includes(c.status)||c.readingPending)||issues.some(i=>/^(file:|review:|files$|contractMissing$|processing$)/.test(i.field)))return 'Aguardando análise';
 return 'Sem erros';
}
