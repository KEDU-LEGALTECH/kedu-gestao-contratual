import {createHash} from 'node:crypto';
import {sameRequestedValue} from './request-expectations.js';
import {plausibleFieldValue} from './field-plausibility.js';
export const visualTextHash=(text:string)=>createHash('sha256').update(text).digest('hex');
/** Evidence issued after independent visual inspection of the original, never from model
 * confidence or agreement with GLPI. It is not a user confirmation or legal approval. */
export function assistedVisualField(reading:any,key:string,value:string,role:string){
 if(reading.problem||reading.incomplete||reading.formulaCount||['simulation','counterproposal','report'].includes(role))return null;
 const allowed=role==='bank'?['banco','agencia','conta','titularConta','documentoTitular']:['cnpj','razaoSocial','nomeFantasia','endereco','rua','numero','bairro','cep','cidade','estado'];
 if(!allowed.includes(key)||!plausibleFieldValue(key,value)||reading.fields?.[key]?.length!==1)return null;
 const hash=visualTextHash(reading.text||'');
 const compact=(s:string)=>s.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
 return (reading.assistedVisualEvidence||[]).find((e:any)=>e.source==='original-visual-inspection'&&e.reviewer==='assistant-local-pilot'&&e.textHash===hash&&/^[a-f0-9]{64}$/.test(e.originalHash||'')&&e.originalHash===reading.originalHash&&e.field===key&&sameRequestedValue(key,e.value,value)&&Number.isInteger(e.page)&&e.page>=1&&e.page<=(reading.pages||1)&&e.excerpt?.length>=3&&compact(e.excerpt).includes(compact(value))&&e.entity?.trim()&&e.reviewedAt&&e.sourceFileId===reading.sourceFileId)||null;
}
export function assistedVisualAbsence(reading:any,key:string){
 if(reading.problem||reading.incomplete||reading.pendingPages?.length||reading.fields?.[key]?.length||!Number.isInteger(reading.pages)||reading.pages<1)return false;
 return (reading.assistedVisualAbsences||[]).some((e:any)=>e.source==='original-visual-inspection'&&e.reviewer==='assistant-local-pilot'&&e.field===key&&e.textHash===visualTextHash(reading.text||'')&&e.originalHash===reading.originalHash&&/^[a-f0-9]{64}$/.test(e.originalHash||'')&&e.sourceFileId===reading.sourceFileId&&e.reviewedAt&&Array.isArray(e.pages)&&Array.from({length:reading.pages},(_,i)=>i+1).every(p=>e.pages.includes(p)));
}
