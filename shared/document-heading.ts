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
