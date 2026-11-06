/** Describes uncertainty without changing the result of the document comparison. */
export function pendingReason(row:any):{code:string;label:string;action:string}|undefined {
 const reason=row.missingReason;
 const make=(code:string,label:string,action:string)=>({code,label,action});
 const source=row.expectedDocument?` (${row.expectedDocument})`:'';
 if(reason==='awaiting_version')return make(reason,'Versão atual pendente','Sincronize o chamado e atualize a leitura dos anexos da versão atual.');
 if(reason==='coverage_partial')return make(reason,'Cobertura parcial','Confira os anexos e as aprovações diretamente no chamado antes de pedir o reenvio: nem todas as origens puderam ser consultadas.');
 if(reason==='value_unassociated')return make(reason,'Valor encontrado sem associação',`Confira no original se o valor pertence a este campo${source}. A presença no texto não confirma o campo.`);
 if(reason==='download_pending')return make(reason,'Arquivo ainda não importado','Atualize a leitura para obter o anexo que consta no chamado.');
 if(/formato sem leitor/i.test(row.message||''))return make('unsupported','Formato sem leitor','Abra o original e peça uma cópia em PDF, imagem, Word, ODT, XLSX, PPTX, TXT ou CSV. Não se trata de falha de OCR.');
 if(reason==='empty_source')return make(reason,'Anexo recebido em branco','O arquivo foi enviado, mas não contém documento visível. Peça o reenvio da imagem ou do documento correto.');
 if(reason==='not_sent'||row.field==='files')return make('not_sent','Arquivo não enviado',`Anexe ao chamado o documento de origem${source} e sincronize novamente.`);
 if(reason==='download_failed'||/não foi possível (?:baixar|obter).*anexo|anexo ainda não obtido/i.test(row.message||''))return make('download_failed','Falha ao baixar','Confira se o anexo abre no GLPI e tente sincronizar e atualizar a leitura novamente.');
 if(reason==='partial'||row.reviewReason?.code==='partial_source'||/^review:partial:/.test(row.field||''))return make('partial','Página não lida','Atualize a leitura para recuperar as páginas restantes. Se persistir, envie uma cópia completa e legível.');
 if(reason==='read_failed'||reason==='unreadable'||/^file:/.test(row.field||''))return make('read_failed','Falha na leitura','Abra o original e atualize a leitura. Se persistir, envie uma cópia legível em formato suportado.');
 if(reason==='source_unidentified')return make(reason,'Origem não identificada',`Identifique qual anexo contém o campo${source}. Não é possível afirmar que o arquivo não foi enviado.`);
 if(reason==='not_printed')return make(reason,'Dado não informado','Solicite um documento que contenha o dado ou esclareça a informação no chamado.');
 if(reason==='not_located'||row.status==='missing')return make('not_located','Campo não localizado',`Confira o campo no original${source} e faça uma releitura do trecho onde ele aparece.`);
 if(row.status==='review'||/^review:/.test(row.field||''))return make('confirmation','Valor aguardando confirmação','Compare o valor e o trecho de origem com o original. Confirme a leitura somente se estiverem corretos.');
}
