export type EvidenceFile={name:string;text?:string;problem?:string;incomplete?:boolean;kind?:string};
export function documentSourceKind(file:EvidenceFile) {
 const norm=(value:string)=>value.normalize('NFD').replace(/\p{Diacritic}/gu,'').replace(/_/g,' ').toLowerCase();
 // Explicit filename/title wins over incidental mentions of another document.
 for(const text of [norm(file.name),norm((file.text||'').slice(0,1500))]){
  if(/contraproposta/.test(text))return 'counterproposal';
  if(/contrato social|alteracao (?:do )?contratual|ato constitutivo|requerimento de empresario/.test(text))return 'social';
  if(/procuracao|outorgante[\s\S]{0,100}outorgad/.test(text))return 'proxy';
  if(/cartao.*cnpj|cadastro nacional da pessoa juridica|comprovante de inscricao e de situacao cadastral/.test(text))return 'registration';
  if(/contrato|instrumento.*(?:garantia|recebiveis)|aditivo/.test(text))return 'contract';
  if(/comprovante bancario|dados bancarios|pix.*gerenciador|comprovante.*(?:pix|transferencia)|titularidade.*conta/.test(text))return 'bank';
  if(/proposta|simulacao|parcelamentos contratados/.test(text))return 'proposal';
 }
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
/** Unknown or inaccessible attachments must never be declared absent. */
export function missingFieldEvidence(field:string,files:EvidenceFile[]) {
 const origin=origins[field]||{label:'Contrato ou documento de apoio correspondente',kinds:['contract']};
 const sources=files.map(file=>({...file,kind:file.kind||documentSourceKind(file)}));
 const relevant=sources.filter(file=>origin.kinds.includes(file.kind));
 const uncertain=sources.some(file=>file.kind==='unknown');
 const reason=!sources.length||(!relevant.length&&!uncertain)?'not_sent':!relevant.length?'source_unidentified':relevant.some(file=>file.problem||file.incomplete)?'unreadable':'not_located';
 const message=reason==='not_sent'?`Documento de origem não enviado/identificado entre os anexos: ${origin.label}.`:
 reason==='source_unidentified'?`Não foi possível identificar qual anexo contém este campo. Fonte esperada: ${origin.label}.`:
 reason==='unreadable'?`O documento de origem foi enviado, mas a leitura falhou ou ficou parcial. Fonte esperada: ${origin.label}.`:
 `O documento de origem foi enviado, mas este campo não foi localizado. Confira o trecho no original: ${origin.label}.`;
 return {reason,expectedDocument:origin.label,sourceDocuments:relevant.map(file=>file.name),message};
}
