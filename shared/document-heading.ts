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
 const s=normalize(value)
  .replace(/\.(?:pdf|docx?|odt|txt|png|jpe?g|webp|tiff?|bmp|gif)$/,'')
  .replace(/^modelo\s*:?\s*/,'')
  .replace(/^juridico\s*:\s*/,'')
  .replace(/^solicitacao\s+(?:de\s+)?/,'')
  .replace(/^(?:minuta\s+(?:de\s+|do\s+|da\s+)?|instrumento\s+particular\s+de\s+|termo\s+de\s+(?=(?:contrato|aditivo|aditamento)\b))/,'');
 if(/^contrato.*\bbuffet\b/.test(s))return 'Contrato de prestação de serviço de buffet';
 if(/^contrato.*\b(evento|eventos)\b/.test(s))return 'Contrato de eventos';
 if(/^contrato.*\blocacao\b/.test(s))return 'Contrato de locação';
 if(/^(?:termo de |instrumento particular de |acordo de )?(?:parcelamento|confissao(?: e parcelamento)? de divida)\b/.test(s))return 'Parcelamento';
 if(/^(?:\d+[ºoª°]?\s+|primeiro |segundo |terceiro |quarto |quinto |sexto |setimo |oitavo |nono |decimo )?(?:termo\s+(?:de\s+)?)?(?:aditivo|aditamento)\b/.test(s))return 'Aditivo';
 if(/^(?:termo de |instrumento particular de )?(?:distrato|rescisao(?:\s+contratual)?)\b/.test(s))return 'Distrato';
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
 const rawLines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
 const lines=rawLines.map(normalize).slice(0,35);
 const supporting=/^(?:modelo(?: de)?|minuta em branco|contraproposta|proposta|simulacao|demonstrativo|relatorio|notificacao|declaracao|comprovante|cartao cnpj|procuracao|recibo|certidao|contrato social|alteracao contratual da sociedade|ato constitutivo|boleto|fatura|nota fiscal|danfe|extrato|estatuto|ata de|alvara|ficha cadastral|oficio|carta|comunicado)\b/;
 const first=lines[0]?.replace(/^\[[^\]]+\]\s*/,'')||'';
 if(/^(?:\d+\s*[º°ªo.]?\s+|\w+\s+)?(?:termo\s+)?(?:aditivo|alteracao|consolidacao)\b.{0,60}\bcontrato social\b/.test(first))return false;
 if(supporting.test(first)||/\bcontrato\s+social\b/.test(lines.slice(0,5).join(' '))&&!headingType(first))return false;
 if(/\bpelo risco\b|\bjira service management\b/.test(first))return false;
 for(const line of lines){
  if(/^contrato\s+(?:firmado|assinado|celebrado|foi|sera|ja\b|para\s+todos|de\s+\d+\s+(?:ano|anos|mes|meses)|12\s+e\s+24\s+meses|educacional\s+\d{4}\s+no\b)\b/.test(line))continue;
  if(/^rescisao\s+cancelamento\s+antes\b/.test(line))continue;
  if(/^contrato social\b/.test(line))return false;
  const heading=line.replace(/^(?:\d+\s*[º°ªo.]?\s+|(?:decimo|vigesimo)(?:\s+\w+)?\s+)/,'');
  if(headingType(heading)||/^(?:termo (?:aditivo|de aditamento)|instrumento particular de (?:rescisao|distrato|confissao(?: e parcelamento)? de divida|prestacao de servicos|aditamento|cessao|parceria|antecipacao)|termo (?:de (?:rescisao|encerramento contratual|adesao|acordo)|anexo ao contrato))\b/.test(heading))return true;
 }
 if(rawLines.length===1&&!/\b(?:contrato social|alteracao contratual|consolidacao contratual|contraproposta|proposta|simulacao|relatorio|comprovante|cartao cnpj|pelo risco)\b/.test(first)){
  const segments=rawLines[0].replace(/\.\w+$/,'').split(/\s*[-–—]\s*/).map(normalize).filter(Boolean);
  if(segments.some(seg=>{const h=seg.replace(/^(?:\d+\s*[º°ªo.]?\s+)/,'');return Boolean(headingType(h));}))return true;
  if(/\b(?:contrato\s+(?:kedu|educacional|regular|integral|de\s+garantia|de\s+prestacao)|termo\s+aditivo|aditivo\s+contratual|distrato\s+contratual)\b/.test(first))return true;
 }
 const opening=normalize(text.slice(0,12000));
 const spacedHeading=lines.some(line=>line.replace(/ /g,'').startsWith('contratodepatrocinio'));
 const hasParties=/\b(?:contratante|contratada|contratado|cedente|cessionaria)\b/.test(opening);
 const hasClauses=/\bclausula\b/.test(opening);
 const hasExplicitContractBody=/\bcontratante\b/.test(opening)&&/\bcontratad[ao]\b/.test(opening)&&/\b(?:taxa de remuneracao|remuneracao kedu|percentual de garantia|percentual de repasse|inicio da vigencia|objeto|rescisao)\b/.test(opening);
 return ((spacedHeading||/\bpelo presente (?:instrumento|contrato|termo|aditivo) particular\b/.test(opening))&&hasParties&&hasClauses)||hasExplicitContractBody;
}

