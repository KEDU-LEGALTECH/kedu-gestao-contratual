/** Explain what remains unresolved; a matching reference is not itself evidence. */
export function comparisonReviewReason(input:{tradeName?:boolean;guided:boolean;qualifiedName:boolean;conflictingValues:boolean;readings:{incomplete?:boolean;problem?:string;formulaCount?:number;pages?:number;fieldOrigins?:Record<string,unknown[]>;digitalFieldOrigins?:Record<string,unknown[]>}[];field:string}){
 if(input.conflictingValues)return {code:'conflicting_values',message:'Os anexos informam valores diferentes para este campo. Identifique a empresa, conta ou versão correspondente ao pedido.'};
 if(input.tradeName)return {code:'trade_name',message:'O nome lido vem do cabeçalho de uma proposta ou anexo, no formato NOME (CNPJ), sem forma jurídica. Pode ser o nome comercial da escola; confira a razão social no contrato social ou cartão CNPJ.'};
 if(input.qualifiedName)return {code:'qualified_name',message:'Um dos nomes inclui uma mantenedora ou associação entre parênteses. Confirme a identificação da empresa antes de considerar os nomes iguais ou diferentes.'};
 if(input.guided)return {code:'value_unassociated',message:'O valor foi localizado no texto, mas sua associação a este campo ainda não foi comprovada. Confira o rótulo, a empresa e o trecho de origem.'};
 if(input.readings.some(r=>r.incomplete))return {code:'partial_source',message:'A leitura do anexo de origem ficou parcial. Este campo ainda não tem evidência independente suficiente para confirmação.'};
 if(input.readings.some(r=>r.formulaCount))return {code:'spreadsheet_calculation',message:'O campo depende de uma planilha com cálculos. Confira as células e o valor no arquivo original.'};
 if(input.readings.length&&input.readings.every(r=>r.pages!==1&&!r.fieldOrigins?.[input.field]?.length&&!r.digitalFieldOrigins?.[input.field]?.length))return {code:'missing_provenance',message:'O valor foi extraído, mas falta localizar com segurança a página e o trecho que comprovam este campo.'};
 return {code:'uncertain_reading',message:'O valor foi extraído, mas ainda não há leitura suficientemente comprovada para este campo. Confira o trecho no original; a coincidência com o GLPI, sozinha, não confirma a leitura.'};
}
