import {fieldsFromLines} from './processing-extract.js';
import {sameRequestedValue,distinctRequestedValues} from './request-expectations.js';
import {recoverTextFields} from './text-recovery.js';
import {withDocumentAddress} from './comparison-evidence.js';

function labelledFields(text:string){
 const parsed=fieldsFromLines(text.split(/\r?\n/).map((s:string)=>s.trim()).filter(Boolean));
 const recovered=recoverTextFields(text,{});
 const fields:Record<string,string[]>={};
 for(const key of new Set([...Object.keys(parsed),...Object.keys(recovered)]))fields[key]=distinctRequestedValues(key,[...(parsed[key]||[]),...(recovered[key]||[])]);
 return withDocumentAddress(fields);
}

/** Agreement between OCR passes plus an explicit field in the original, independently of GLPI. */
export function verifiedFieldEvidence(reading:any,key:string,value:string,role:string) {
 if(reading.problem||reading.incomplete||(reading.formulaCount||0)>0||['simulation','counterproposal','report'].includes(role))return false;
 if(!['razaoSocial','nomeFantasia','representanteNome','cep','cidade','estado','rua','numero','bairro','endereco','banco','agencia','conta','titularConta'].includes(key))return false;
 const origin=reading.fieldOrigins?.[key]?.find((o:any)=>sameRequestedValue(key,o.value,value));
 if(reading.pages!==1&&!origin?.page)return false;
 const text=origin?.excerpt||reading.text||'';
 if(['banco','agencia','conta','titularConta'].includes(key)&&role!=='bank'&&!/dados banc[áa]rios|titular(?:idade)? da conta/i.test(text))return false;
 const fields=labelledFields(text);
 const values=distinctRequestedValues(key,fields[key]||[]);
 if(values.length!==1||!sameRequestedValue(key,values[0],value))return false;
 if(reading.verifiedFields?.includes(key)&&(reading.fieldConfidence?.[key]??reading.confidence??0)>=85)return true;
 // A low document-wide average must not hide a field independently read by
 // Tesseract and PaddleOCR. Each engine must yield one explicit, equal value.
 if(!/PaddleOCR/.test(reading.method||''))return false;
 const passes=String(reading.text||'').split(/\n\s*LEITURA ADICIONAL\s*[—–-]\s*PADDLEOCR\s*\/\s*OPENCV\s*\n/i);
 if(passes.length<2)return false;
 if(passes.length===2)return passes.every(pass=>{const candidates=distinctRequestedValues(key,labelledFields(pass)[key]||[]);return candidates.length===1&&sameRequestedValue(key,candidates[0],value);});
 const matchedPasses=passes.filter(pass=>{const candidates=distinctRequestedValues(key,labelledFields(pass)[key]||[]);return candidates.length===1&&sameRequestedValue(key,candidates[0],value);});
 const conflictingPasses=passes.some(pass=>{const candidates=distinctRequestedValues(key,labelledFields(pass)[key]||[]);return candidates.some(c=>!sameRequestedValue(key,c,value));});
 return matchedPasses.length>=2&&!conflictingPasses;
}
