export type EvidenceFile={name:string;text?:string;problem?:string;incomplete?:boolean;kind?:string;downloadFailed?:boolean;downloadPending?:boolean;emptyContent?:boolean};
export function documentSourceKind(file:EvidenceFile) {
 const norm=(value:string)=>value.normalize('NFD').replace(/\p{Diacritic}/gu,'').replace(/_/g,' ').toLowerCase();
 // Explicit filename/title wins over incidental mentions of another document.
 for(const text of [norm(file.name),norm((file.text||'').slice(0,1500))]){
  if(/contraproposta/.test(text))return 'counterproposal';
  if(/contrato social|alteracao (?:do )?contratual|ato constitutivo|requerimento de empresario/.test(text))return 'social';
  if(/procuracao|outorgante[\s\S]{0,100}outorgad/.test(text))return 'proxy';
  if(/cartao.*cnpj|cadastro nacional da pessoa juridica|comprovante de inscricao e de situacao cadastral/.test(text))return 'registration';
  if(/contrato|instrumento.*(?:garantia|recebiveis)|aditivo/.test(text))return 'contract';
  if(/comprovante bancario|dados bancarios|pix.*gerenciador|comprovante.*(?:pix|transferencia)|titularidade.*conta/.test(text)||(/recebedor/.test(text)&&/pagador/.test(text)&&/instituicao/.test(text)))return 'bank';
  if(/proposta|simulacao|parcelamentos contratados/.test(text))return 'proposal';
 }
 // Generic WhatsApp filenames do not identify a bank screenshot. Require the
 // account-screen context and both explicit agency/account labels, not a name.
 const screen=norm(file.text||'');
 if(/\bsicredi\b/.test(screen)&&/\bassociad[oa]\s*:\s*\p{L}/u.test(screen)&&/\bcooperativa\s*:\s*\d{1,6}\b/.test(screen)&&/\bconta\s*:\s*\d{2,15}-[\dx]\b/.test(screen))return 'bank';
 if(/\.(?:png|jpe?g|webp)$/i.test(file.name)&&/\b(?:acessar conta|saldo|conta corrente)\b/.test(screen)&&/\bag\.?\s*:?\s*\d{1,6}(?:-[\dx])?\s*[-·•«| ]*cc\.?\s*:?\s*\d{2,15}/i.test(screen))return 'bank';
 if(/\.xlsx$/i.test(file.name))return 'proposal';
 return 'unknown';
}
const origins:Record<string,{label:string;kinds:string[]}>= {
 representanteNome:{label:'Contrato social ou procuração',kinds:['social','proxy','contract']},
 representanteCpf:{label:'Contrato social ou procuração',kinds:['social','proxy','contract']},
 endereco:{label:'Cartão CNPJ',kinds:['registration','social','contract']},
 rua:{label:'Cartão CNPJ',kinds:['registration','social','contract']},
 numero:{label:'Cartão CNPJ',kinds:['registration','social','contract']},
 bairro:{label:'Cartão CNPJ',kinds:['registration','social','contract']},
 cep:{label:'Cartão CNPJ',kinds:['registration','social','contract']},
 cidade:{label:'Cartão CNPJ',kinds:['registration','social','contract']},
 estado:{label:'Cartão CNPJ',kinds:['registration','social','contract']},
 cnpj:{label:'Cartão CNPJ, contrato social ou contrato',kinds:['registration','social','contract']},
 razaoSocial:{label:'Cartão CNPJ, contrato social ou contrato',kinds:['registration','social','contract']},
 nomeFantasia:{label:'Cartão CNPJ',kinds:['registration','contract']},
};
for(const key of ['banco','agencia','conta','titularConta','documentoTitular','pix'])origins[key]={label:'Comprovante bancário',kinds:['bank','contract']};
for(const key of ['valor','valorParcela','valorTotal','parcelas','remuneracao','garantia','repasse'])origins[key]={label:'Proposta ou contrato',kinds:['proposal','contract']};
// A field label only identifies a source to inspect; it never confirms its value.
function hasExplicitFieldLabel(field:string,text:string) {
 const normalized=text.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
 const labels:Record<string,string>={
  razaoSocial:'razao social',nomeFantasia:'nome fantasia',cnpj:'cnpj',
  banco:'banco',agencia:'agencia',conta:'conta(?: corrente)?',
  titularConta:'titular (?:da )?conta',documentoTitular:'(?:cpf|cnpj|cpf/cnpj|documento) do titular(?: da conta)?',pix:'(?:chave )?pix',
  valorTotal:'valor total',valorParcela:'valor (?:da )?parcela',parcelas:'(?:numero|quantidade) de parcelas',
  remuneracao:'remuneracao',repasse:'repasse',
  representanteNome:'(?:nome do )?representante legal',representanteCpf:'cpf do representante(?: legal)?',
 };
 const label=labels[field];
 if(!label)return false;
 const pattern=new RegExp(`(?:^|[\\n\\r;|])[ \\t]*(?:${label})[ \\t]*[:=][ \\t]*([^\\n\\r;|]+)`,'gm');
 for(const match of normalized.matchAll(pattern)){
  const value=match[1].trim();
  if(!/[\p{L}\p{N}]/u.test(value)||/^(?:nao (?:informad|disponivel|consta)|sera\b|a (?:informar|definir)|pendente\b)/.test(value))continue;
  if(['agencia','conta','cnpj','documentoTitular','representanteCpf','parcelas','valorTotal','valorParcela','remuneracao','repasse'].includes(field)&&!/^(?:r\$[ \t]*)?\d/.test(value))continue;
  return true;
 }
 return false;
}
/** Unknown or inaccessible attachments must never be declared absent. */
export function missingFieldEvidence(field:string,files:EvidenceFile[],incompleteCoverage=false) {
 const origin=origins[field]||{label:'Contrato ou documento de apoio correspondente',kinds:['contract']};
 const sources=files.map(file=>({...file,kind:file.kind||documentSourceKind(file)}));
 const relevant=sources.filter(file=>origin.kinds.includes(file.kind)||hasExplicitFieldLabel(field,file.text||''));
 const uncertain=sources.some(file=>file.kind==='unknown');
 // An unread attachment can contain this field regardless of its filename/type.
 const candidates=relevant.length?relevant:sources.filter(file=>file.kind==='unknown'||file.downloadFailed||file.downloadPending||file.problem||file.incomplete);
 // Only a complete search of the ticket can say that a document was not sent.
 const notSent=incompleteCoverage?'coverage_partial':'not_sent';
 const reason=!sources.length?notSent:candidates.some(file=>file.downloadFailed)?'download_failed':candidates.some(file=>file.downloadPending)?'download_pending':candidates.some(file=>file.emptyContent)?'empty_source':!relevant.length&&uncertain?'source_unidentified':candidates.some(file=>file.incomplete)?'partial':candidates.some(file=>file.problem)?'read_failed':!relevant.length?notSent:'not_located';
 const message=reason==='not_sent'?`Documento de origem não enviado/identificado entre os anexos: ${origin.label}.`:
 reason==='coverage_partial'?`Nenhum documento de origem foi identificado nos anexos consultados, mas a consulta ao GLPI ficou incompleta. Não é possível afirmar que o arquivo não foi enviado. Fonte esperada: ${origin.label}.`:
 reason==='empty_source'?`O anexo foi recebido, mas a imagem está em branco e não contém o dado. Solicite o documento correto. Fonte esperada: ${origin.label}.`:
 reason==='source_unidentified'?`Não foi possível identificar qual anexo contém este campo. Fonte esperada: ${origin.label}.`:
 reason==='download_failed'?`O anexo consta no chamado, mas não foi possível baixar seu conteúdo. Fonte esperada: ${origin.label}.`:
 reason==='download_pending'?`O anexo consta no chamado, mas seu conteúdo ainda não foi obtido. Fonte esperada: ${origin.label}.`:
 reason==='partial'?`A leitura do documento de origem ficou parcial; há páginas ou trechos ainda não lidos. Fonte esperada: ${origin.label}.`:
 reason==='read_failed'?`O original foi obtido, mas não foi possível concluir sua leitura. Fonte esperada: ${origin.label}.`:
 `O documento de origem foi enviado, mas este campo não foi localizado. Confira o trecho no original: ${origin.label}.`;
 return {reason,expectedDocument:origin.label,sourceDocuments:relevant.map(file=>file.name),message};
}
