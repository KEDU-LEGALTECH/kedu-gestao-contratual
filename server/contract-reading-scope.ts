import {isContractInstrument} from '../shared/document-heading.js';
import {supportedReading} from './file-reading.js';
import {templateDocument} from './comparison-profile.js';
import {needsReadingRecovery} from './reading-recovery-policy.js';

const fold=(text:string)=>text.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[_–—-]/g,' ').replace(/\s+/g,' ').trim();
const supportHeading=/^(?:anexo \w+ demonstrativo|demonstrativo|contraproposta|proposta(?: comercial| de antecipacao| de adiantamento)?|simulacao|planilha|relatorio|comprovante|cartao cnpj|certidao|notificacao|declaracao|procuracao|recibo|ato constitutivo|dados bancarios|registro geral|carteira de identidade|carteira nacional de habilitacao|captura de tela)\b/;
const supportName=/\b(?:contrato social|alteracao contratual|consolidacao contratual|cartao cnpj|comprovante bancario|cnpj cartao)\b|^(?:cnpj|rg|cpf|cnh|logo|assinatura)(?:\b|\.)/;

export function isFilledContract(text:string){
 const opening=text.slice(0,2000);
 return isContractInstrument(text)&&!(templateDocument(opening)&&/\b(?:nome|cpf|cnpj)\s*:\s*\{\{/i.test(opening));
}
type Cached={extracted:string;byteLength?:number;problem?:string;name?:string};
export function contractReadingScope(name:string,file?:Cached){
 let reading:any={};
 try{reading=JSON.parse(file?.extracted||'{}')||{};}catch{}
 const text=String(reading.text||'');
 const opening=fold(text.slice(0,1500));
 const first=fold(text.split(/\r?\n/).find(line=>line.trim())||'');
 const filename=fold(name);
 if(isFilledContract(text))return {kind:'contract' as const,needsWork:reading.triageOnly===true||needsReadingRecovery(file)};
 if(/\bcadastro nacional da pessoa juridica\b|\bcomprovante de inscricao e de situacao cadastral\b/.test(opening)||supportHeading.test(first)||supportName.test(first)||supportHeading.test(filename)||supportName.test(filename)||/\.(?:xlsx?|csv|pptx?|zip|rar|7z)$/i.test(name)||isContractInstrument(text))
  return {kind:'support' as const,needsWork:false};
 if(reading.contractIdentified===true)return {kind:'contract' as const,needsWork:needsReadingRecovery(file)};
 if(isContractInstrument(name)&&(!text.trim()||reading.incomplete)&&!reading.triageOnly)
  return {kind:'contract' as const,needsWork:needsReadingRecovery(file)};
 const finished=(reading.triageOnly&&!reading.transient)||!needsReadingRecovery(file)||!supportedReading.test(name);
 return {kind:'unknown' as const,needsWork:!finished};
}
