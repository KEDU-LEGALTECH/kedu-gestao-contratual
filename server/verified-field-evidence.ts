import {fieldsFromLines} from './processing-extract.js';
import {sameRequestedValue,distinctRequestedValues} from './request-expectations.js';

/** Agreement between OCR passes plus an explicit field in the original, independently of GLPI. */
export function verifiedFieldEvidence(reading:any,key:string,value:string,role:string) {
 if(reading.problem||reading.incomplete||(reading.formulaCount||0)>0||['simulation','counterproposal','report'].includes(role))return false;
 if(!reading.verifiedFields?.includes(key)||(reading.fieldConfidence?.[key]??reading.confidence??0)<85)return false;
 if(!['razaoSocial','nomeFantasia','representanteNome','cep','cidade','estado','rua','numero','bairro','endereco','banco','agencia','conta','titularConta'].includes(key))return false;
 const origin=reading.fieldOrigins?.[key]?.find((o:any)=>sameRequestedValue(key,o.value,value));
 if(reading.pages!==1&&!origin?.page)return false;
 const text=origin?.excerpt||reading.text||'';
 if(['banco','agencia','conta','titularConta'].includes(key)&&role!=='bank'&&!/dados banc[áa]rios|titular(?:idade)? da conta/i.test(text))return false;
 const fields=fieldsFromLines(text.split(/\r?\n/).map((s:string)=>s.trim()).filter(Boolean));
 const values=distinctRequestedValues(key,fields[key]||[]);
 return values.length===1&&sameRequestedValue(key,values[0],value);
}
