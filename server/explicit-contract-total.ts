/** Contract totals explicitly declared in prose; never infer a total from a fee,
 * a GLPI value or the largest currency amount printed in a document. */
export function explicitContractTotals(text:string):string[] {
 const pattern=/\bvalor\s+total\s+(?:dos\s+servi[çc]os\s+contratados|da\s+contrata[çc][ãa]o|do\s+contrato)\s+[ée]\s+(?:de\s+)?R\$\s*((?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{2})?)(?!\d|[.,]\d)/gi;
 return [...new Set([...text.matchAll(pattern)].map(m=>m[1].replace(/\./g,'')+(m[1].includes(',')?'':',00')))];
}


