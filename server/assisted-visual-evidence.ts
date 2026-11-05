import {createHash} from 'node:crypto';
import {sameRequestedValue} from './request-expectations.js';
import {plausibleFieldValue} from './field-plausibility.js';
import {explicitContractTotals} from './explicit-contract-total.js';
export const visualTextHash=(text:string)=>createHash('sha256').update(text).digest('hex');
/** Evidence issued after independent visual inspection of the original, never from model
 * confidence or agreement with GLPI. It is not a user confirmation or legal approval. */
export function assistedVisualField(reading:any,key:string,value:string,role:string){
 if(reading.problem||reading.incomplete||reading.formulaCount||['simulation','counterproposal','report'].includes(role))return null;
 const allowed=role==='bank'?['banco','agencia','conta','titularConta','documentoTitular']:['cnpj','razaoSocial','nomeFantasia','endereco','rua','numero','bairro','cep','cidade','estado',...(role==='document'?['valorTotal']:[])];
 if(!allowed.includes(key)||!plausibleFieldValue(key,value)||reading.fields?.[key]?.length!==1)return null;
 const hash=visualTextHash(reading.text||'');
 const compact=(s:string)=>s.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
 return (reading.assistedVisualEvidence||[]).find((e:any)=>e.source==='original-visual-inspection'&&e.reviewer==='assistant-local-pilot'&&e.textHash===hash&&/^[a-f0-9]{64}$/.test(e.originalHash||'')&&e.originalHash===reading.originalHash&&e.field===key&&sameRequestedValue(key,e.value,value)&&Number.isInteger(e.page)&&e.page>=1&&e.page<=(reading.pages||1)&&e.excerpt?.length>=3&&(key==='valorTotal'?verifiedVisualTotal(reading,e,value,hash):compact(e.excerpt).includes(compact(value)))&&e.entity?.trim()&&e.reviewedAt&&e.sourceFileId===reading.sourceFileId)||null;
}
/** A financial OCR value needs a contractual clause and a second printed total on
 * another inspected page, plus complete, version-bound visual coverage. */
function verifiedVisualTotal(reading:any,e:any,value:string,hash:string){
 const coverage=reading.assistedVisualCoverage,other=e.corroboration;
 if(reading.pendingPages?.length||!Number.isInteger(reading.pages)||reading.pages<2||!coverage||coverage.source!=='original-visual-inspection'||coverage.reviewer!=='assistant-local-pilot'||coverage.originalHash!==reading.originalHash||coverage.textHash!==hash||coverage.sourceFileId!==reading.sourceFileId||!coverage.reviewedAt||!Array.isArray(coverage.pages)||!Array.from({length:reading.pages},(_,i)=>i+1).every(p=>coverage.pages.includes(p)))return false;
 const totals=explicitContractTotals(e.excerpt);
 if(totals.length!==1||!sameRequestedValue('valorTotal',totals[0],value)||!other||!Number.isInteger(other.page)||other.page<1||other.page>reading.pages||other.page===e.page||!/\bTOTAL\b/i.test(other.excerpt||''))return false;
 const printed=[...String(other.excerpt).matchAll(/R\$\s*((?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{2})?)(?!\d|[.,]\d)/g)].map(m=>m[1]);
 return printed.length===1&&sameRequestedValue('valorTotal',printed[0],value);
}
export function assistedVisualAbsence(reading:any,key:string){
 if(reading.problem||reading.incomplete||reading.pendingPages?.length||reading.fields?.[key]?.length||!Number.isInteger(reading.pages)||reading.pages<1)return false;
 return (reading.assistedVisualAbsences||[]).some((e:any)=>e.source==='original-visual-inspection'&&e.reviewer==='assistant-local-pilot'&&e.field===key&&e.textHash===visualTextHash(reading.text||'')&&e.originalHash===reading.originalHash&&/^[a-f0-9]{64}$/.test(e.originalHash||'')&&e.sourceFileId===reading.sourceFileId&&e.reviewedAt&&Array.isArray(e.pages)&&Array.from({length:reading.pages},(_,i)=>i+1).every(p=>e.pages.includes(p)));
}
