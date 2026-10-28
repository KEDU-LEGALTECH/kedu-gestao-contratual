import {sameRequestedValue} from './request-expectations.js';
import {validCnpj} from './registration-reading.js';
export function validCpf(value:string) {
 const d=value.replace(/\D/g,'');if(!/^\d{11}$/.test(d)||/^(.)\1+$/.test(d))return false;
 for(const size of [9,10]){let sum=0;for(let i=0;i<size;i++)sum+=Number(d[i])*(size+1-i);const digit=(sum*10)%11%10;if(digit!==Number(d[size]))return false;}
 return true;
}
type Source={name:string;fields:Record<string,string[]>;incomplete?:boolean;problem?:string};
export type ReadingFinding={field:string;source:string;message:string;kind:'invalid'|'consistency';found:string};
const money=(value:string)=>{const match=/^(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})$/.exec(value.trim());return match?Number(match[1].replaceAll('.',''))*100+Number(match[2]):null;};
export function validateReadings(sources:Source[]) {
 const findings:ReadingFinding[]=[];
 for(const source of sources){
  const one=(key:string)=>source.fields[key]?.length===1?source.fields[key][0]:'';
  const add=(field:string,message:string,found:string,kind:'invalid'|'consistency'='invalid')=>findings.push({field,source:source.name,message,found,kind});
  for(const key of ['representanteCpf','documentoTitular','cnpj'])for(const value of source.fields[key]||[]){
   const digits=value.replace(/\D/g,'');const valid=key==='representanteCpf'?validCpf(value):key==='cnpj'?validCnpj(value):digits.length===11?validCpf(value):validCnpj(value);
   if(!valid)add(key,'Dígitos verificadores inválidos no texto extraído. Confira o original antes de considerar erro de preenchimento.',value);
  }
  for(const key of ['inicio','fim','dataFormalizacao','dataAssinaturaMatriz'])for(const value of source.fields[key]||[]){
   if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value||Number(value.slice(0,4))<1900||Number(value.slice(0,4))>2100)add(key,'Data inválida ou fora do intervalo de conferência (1900–2100).',value);
  }
  if(one('inicio')&&one('fim')&&one('inicio')>one('fim'))add('fim','Fim da vigência anterior ao início.',one('fim'));
  for(const key of ['remuneracao','garantia','repasse','repasseSegundo','cashback'])for(const value of source.fields[key]||[]){const n=Number(value.replace('%','').replace(',','.'));if(!Number.isFinite(n)||n<0||n>100)add(key,'Percentual fora da faixa de 0% a 100%.',value);}
  const total=money(one('valorTotal')),part=money(one('valorParcela')),count=one('parcelas');
  if(total!==null&&part!==null&&/^\d+$/.test(count)&&Number(count)>0&&Math.abs(part*Number(count)-total)>Number(count))add('valorTotal','Valor da parcela × quantidade difere do total explícito. Confira juros, entrada e eventuais parcelas diferentes.',`${one('valorParcela')} × ${count} ≠ ${one('valorTotal')}`,'consistency');
 }
 const byField=(key:string)=>sources.flatMap(s=>(s.fields[key]||[]).map(value=>({source:s.name,value})));
 for(const key of ['cnpj','documentoTitular']){
  const identities=byField(key);if(key==='documentoTitular')identities.push(...byField('cnpj').filter(i=>validCnpj(i.value)));
  if(identities.length>1&&identities.some(i=>!sameRequestedValue('cnpj',i.value,identities[0].value)))findings.push({field:key,source:[...new Set(identities.map(i=>i.source))].join('; '),message:key==='cnpj'?'CNPJs diferentes entre documentos da mesma demanda. Confira a parte contratual.':'Titularidade bancária e CNPJ da organização diferem. Confira a autorização e o titular; não foi presumido erro.',kind:'consistency',found:[...new Set(identities.map(i=>i.value))].join('; ')});
 }
 // Offline corroboration only: no claim of geographic validation without an authoritative lookup.
 for(const a of sources)for(const b of sources){
  if(a.name>=b.name||a.fields.cep?.length!==1||b.fields.cep?.length!==1||!sameRequestedValue('cep',a.fields.cep[0],b.fields.cep[0]))continue;
  for(const key of ['cidade','estado'])if(a.fields[key]?.length===1&&b.fields[key]?.length===1&&!sameRequestedValue(key,a.fields[key][0],b.fields[key][0]))findings.push({field:key,source:a.name+'; '+b.name,kind:'consistency',message:'O mesmo CEP está associado a cidade/UF diferentes nos documentos. Confira os originais; consulta externa não foi realizada.',found:a.fields[key][0]+'; '+b.fields[key][0]});
 }
 return findings;
}
