import {isContractInstrument} from '../shared/document-heading.js';
import {supportedReading} from './file-reading.js';
import {templateDocument} from './comparison-profile.js';
import {needsReadingRecovery} from './reading-recovery-policy.js';

const fold=(text:string)=>text.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[_–—-]/g,' ').replace(/\s+/g,' ').trim();
const supportHeading=/^(?:anexo \w+ demonstrativo|demonstrativo|contraproposta|proposta(?: comercial| de antecipacao| de adiantamento)?|simulacao|planilha|relatorio|comprovante|cartao cnpj|certidao|notificacao|declaracao|procuracao|recibo|ato constitutivo|dados bancarios|registro geral|carteira de identidade|carteira nacional de habilitacao|captura de tela|boleto|fatura|nota fiscal|danfe|extrato|estatuto(?: social)?|ata de (?:assembleia|eleicao|reuniao)|requerimento de empresario|ficha cadastral|alvara|licenca|portaria|regimento escolar|historico escolar|calendario escolar|oficio|carta|comunicado|protocolo|cnd|cndt|crf|fgts|darf|das|balancete|balanco patrimonial|dre|folha de pagamento|quadro de socios|quadro societario)\b/;
const supportName=/\b(?:contrato social|alteracao contratual|consolidacao contratual|constituicao da sociedade|cartao cnpj|comprovante bancario|cnpj cartao|boleto|nota fiscal|danfe|extrato bancario|estatuto social|ata assembleia|ficha cadastral|certidao simplificada|alvara|cnd|cndt|comprovante pix|print tela|captura de tela|image paste\d*|quadro societario|tentativa de contato|relatorio de encerramento|pelo risco)\b|^(?:cnpj|rg|cpf|cnh|logo|conta|socio|cartao)(?:\b|\.)|^assinatura(?:\b|\.)(?!.*\b(?:contrato|aditivo|aditamento|distrato|parcelamento|rescisao|termo|instrumento)\b)/;
const supportContent=/\bcadastro nacional da pessoa juridica\b|\bcomprovante de inscricao e de situacao cadastral\b|\bsecretaria da receita federal\b|\bjunta comercial do estado\b|\bcertidao negativa de debitos\b|\bdocumento auxiliar da nota fiscal\b|\bcomprovante de (?:transferencia|pagamento|pix|ted)\b|\bjira service management\b|\bhelp center\b|\bcomite diretoria c|\bconversa seguindo\b|\bproposta preco comercial\b|\bpropostas alternativas\b|\banalises realizadas\b|\bdados para receber dinheiro\b|\bchaves pix\b|\bmodelo escrow\b|\bmeu pagbank\b|\bextratos pix pagamentos\b|\bsecretaria da seguranca\b|\bcarteira de identidade\b|\bmedida provisoria n\w* 2200\b|\bstatus relatorio de descredenciamento\b/;
const screenshotName=/^(?:whatsapp image|image_paste|captura de tela|screenshot|print)\b/i;

export function isSupportDocument(name:string,text:string){
 const opening=fold(text.slice(0,1500));
 const first=fold(text.split(/\r?\n/).find(line=>line.trim())||'').replace(/^\[[^\]]+\]\s*/,'');
 const filename=fold(name).replace(/^\[[^\]]+\]\s*/,'');
 return supportContent.test(opening)||supportHeading.test(first)||supportName.test(first)||supportHeading.test(filename)||supportName.test(filename)||/\.(?:xlsx?|csv|pptx?|zip|rar|7z)$/i.test(name);
}

export function isFilledContract(text:string,name=''){
 if(!text.trim()||isSupportDocument(name,text))return false;
 const opening=text.slice(0,2000);
 if(templateDocument(opening)&&/\b(?:nome|cpf|cnpj)\s*:\s*\{\{/i.test(opening))return false;
 if(/^modelo\b/i.test(name.trim())&&/(?:nome|endereco|cpf|cnpj)\s*:\s*_{5,}/i.test(opening))return false;
 const folded=fold(opening);
 if(screenshotName.test(name.trim()))return /\bclausula\b/.test(folded)&&/\b(?:contratante|contratad[ao])\b/.test(folded);
 if(isContractInstrument(text))return true;
 if(name&&isContractInstrument(name))return true;
 return /\b(?:taxa de remuneracao|remuneracao kedu|percentual de garantia|percentual de repasse|modalidade de garantia|valor parcelado)\b/.test(folded)&&/\b(?:razao social|cnpj|contratad[ao]|contratante)\b/.test(folded);
}
type Cached={extracted:string;byteLength?:number;problem?:string;name?:string};
export function contractReadingScope(name:string,file?:Cached){
 let reading:any={};
 try{reading=JSON.parse(file?.extracted||'{}')||{};}catch{}
 const text=String(reading.text||'');
 if(isFilledContract(text,name))return {kind:'contract' as const,needsWork:reading.triageOnly===true||needsReadingRecovery(file)};
 if(isSupportDocument(name,text)||isContractInstrument(text))
  return {kind:'support' as const,needsWork:false};
 if(reading.contractIdentified===true)return {kind:'contract' as const,needsWork:needsReadingRecovery(file)};
 if(isContractInstrument(name)&&(!text.trim()||reading.incomplete||reading.triageOnly))
  return {kind:'contract' as const,needsWork:reading.triageOnly===true||needsReadingRecovery(file)};
 if(/\.(?:pdf|docx?|odt)$/i.test(name)&&text.trim().length>=40&&!file?.problem&&!reading.problem&&!reading.incomplete&&!reading.transient)
  return {kind:'support' as const,needsWork:false};
 if(screenshotName.test(name.trim())&&text.trim().length>=20&&!file?.problem&&!reading.problem&&!reading.incomplete&&!reading.transient)
  return {kind:'support' as const,needsWork:false};
 const finished=(reading.triageOnly&&!reading.transient)||!needsReadingRecovery(file)||!supportedReading.test(name);
 return {kind:'unknown' as const,needsWork:!finished};
}

