const normalize=(s:string)=>s.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[_–—-]/g,' ').replace(/\s+/g,' ').trim();
/** Describes the received attachment, independently of the requested instrument. */
export function receivedDocumentKind(name:string,text='') {
 const candidates=[...text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean).slice(0,10),name];
 for(const value of candidates){const s=normalize(value);
  if(/^contraproposta\b/.test(s))return 'Contraproposta';
  if(/^(?:modelo\s*:?\s*)?proposta\b/.test(s))return 'Proposta comercial';
  if(/^relatorio\b/.test(s))return 'Relatório';
  if(/^(?:comprovante|dados bancarios|cartao cnpj|procuracao)\b/.test(s))return 'Documento de apoio';
  const type=headingType(value);if(type)return type;
 }
 if(/\.xlsx?$/i.test(name))return 'Planilha';
 return 'Tipo a identificar';
}
export function headingType(value:string){
 const s=normalize(value).replace(/\.(?:pdf|docx?|png|jpe?g)$/,'').replace(/^modelo\s*:?\s*/,'').replace(/^juridico\s*:\s*/,'').replace(/^solicitacao\s+(?:de\s+)?/,'');
 if(/^contrato.*\bbuffet\b/.test(s))return 'Contrato de prestação de serviço de buffet';
 if(/^contrato.*\b(evento|eventos)\b/.test(s))return 'Contrato de eventos';
 if(/^contrato.*\blocacao\b/.test(s))return 'Contrato de locação';
 if(/^(?:termo de )?(?:parcelamento|confissao de divida)\b/.test(s))return 'Parcelamento';
 if(/^(?:\d+[ºo]?\s+|primeiro |segundo |terceiro )?(?:termo de )?aditivo\b/.test(s))return 'Aditivo';
 if(/^(?:termo de )?distrato\b/.test(s))return 'Distrato';
 if(/^contrato (?:de prestacao de servicos )?educaciona/.test(s))return 'Contrato educacional';
 if(/^contrato.*\b(?:prestacao de servico|prestacao de servicos)\b/.test(s))return 'Contrato de prestação de serviços';
 if(/^contrato.*(?:garantia|recebimento garantido)/.test(s))return 'Contrato de garantia';
 if(/^contrato (?:de |para )?(?:fornecedor|fornecimento)/.test(s))return 'Contrato fornecedor';
 if(/^contrato (?:de )?marketing/.test(s))return 'Contrato marketing';
 if(/^contrato\b/.test(s))return 'Contrato';
 return '';
}
export function identifyDocumentHeading(name:string,text:string){
 for(const line of text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean).slice(0,10)){
  const type=headingType(line);if(type)return {type,heading:line.slice(0,300),source:'Título no início do documento'};
 }
 const type=headingType(name.replace(/\.\w+$/,''));
 return {type,heading:type?name:'',source:type?'Nome do arquivo':'Tipo não identificado no início do documento'};
}

/** The text of an instrument can be used for comparison; a filename can only identify a pending candidate. */
export function isContractInstrument(text:string){
 const lines=text.split(/\r?\n/).map(normalize).filter(Boolean).slice(0,25);
 const supporting=/^(?:modelo(?: de)?|minuta em branco|contraproposta|proposta|simulacao|demonstrativo|relatorio|notificacao|declaracao|comprovante|cartao cnpj|procuracao|recibo|certidao|contrato social|alteracao contratual da sociedade|ato constitutivo)\b/;
 const first=lines[0]||'';
 if(/^(?:\d+\s*[º°ªo.]?\s+|\w+\s+)?(?:termo\s+)?(?:aditivo|alteracao|consolidacao)\b.{0,60}\bcontrato social\b/.test(first))return false;
 if(supporting.test(first)||/\bcontrato\s+social\b/.test(lines.slice(0,5).join(' '))&&!headingType(first))return false;
 for(const line of lines){
  if(/^contrato\s+(?:firmado|assinado|celebrado|foi|sera)\b/.test(line))continue;
  if(/^contrato social\b/.test(line))return false;
  const heading=line.replace(/^(?:\d+\s*[º°ªo.]?\s+|(?:decimo|vigesimo)(?:\s+\w+)?\s+)/,'');
  if(headingType(heading)||/^(?:termo aditivo|instrumento particular de (?:rescisao|distrato|confissao de divida|prestacao de servicos)|termo (?:de (?:rescisao|encerramento contratual|adesao)|anexo ao contrato))\b/.test(heading))return true;
 }
 const opening=normalize(text.slice(0,10000));
 const spacedHeading=lines.some(line=>line.replace(/ /g,'').startsWith('contratodepatrocinio'));
 return (spacedHeading||/\bpelo presente (?:instrumento|contrato) particular\b/.test(opening))
   && /\b(?:contratante|contratada|contratado|cedente|cessionaria)\b/.test(opening)
   && /\bclausula\b/.test(opening);
}
