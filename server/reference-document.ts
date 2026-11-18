// Self-contained: the ticket analysis imports this module, so it must not pull the reading modules in.
const checkDigits=(d:string,size:number,first:number)=>{let sum=0,weight=first;for(let i=0;i<size;i++){sum+=Number(d[i])*weight;if(--weight<2)weight=9;}return sum%11<2?0:11-sum%11;};
const validCnpj=(d:string)=>/^\d{14}$/.test(d)&&!/^(.)\1+$/.test(d)&&checkDigits(d,12,5)===Number(d[12])&&checkDigits(d,13,6)===Number(d[13]);
const validCpf=(d:string)=>{
 if(!/^\d{11}$/.test(d)||/^(.)\1+$/.test(d))return false;
 for(const size of [9,10]){let sum=0;for(let i=0;i<size;i++)sum+=Number(d[i])*(size+1-i);if((sum*10)%11%10!==Number(d[size]))return false;}
 return true;
};
// Kedu's own CNPJ root: listed next to the school in many forms, never the demand's organization.
const ownIdentity=(_key:'cnpj',digits:string)=>digits.startsWith('45543580');

export type ReferenceDocument={digits:string;kind:'cnpj'|'cpf';repaired:boolean};

export const formatDocument=(digits:string)=>digits.length===11
 ?`${digits.slice(0,3)}.${digits.slice(3,6)}.${digits.slice(6,9)}-${digits.slice(9)}`
 :`${digits.slice(0,2)}.${digits.slice(2,5)}.${digits.slice(5,8)}/${digits.slice(8,12)}-${digits.slice(12)}`;
export const validDocument=(digits:string)=>digits.length===14?validCnpj(digits):digits.length===11&&validCpf(digits);

/** The organization identifier typed in a GLPI form. Formats are repaired only when the check digits
 * prove the result: a numeric field that added ",00" or thousand separators, or lost leading zeros.
 * Several identifiers in one field are returned separately; the portal never picks one by itself. */
export function referenceDocuments(raw:string):ReferenceDocument[]{
 const value=String(raw||'').trim(),out:ReferenceDocument[]=[];
 const push=(digits:string,kind:'cnpj'|'cpf',repaired:boolean)=>{if(!ownIdentity('cnpj',digits)&&!out.some(o=>o.digits===digits))out.push({digits,kind,repaired});};
 const listed=[...value.matchAll(/\d{2}\.?\d{3}\.?\d{3}\s*\/\s*\d{4}\s*-?\s*\d{2}|\d{3}\.\d{3}\.\d{3}\s*-\s*\d{2}/g)].map(m=>m[0].replace(/\D/g,''));
 if(listed.length>1){
  for(const digits of listed)if(validDocument(digits))push(digits,digits.length===11?'cpf':'cnpj',false);
  return out;
 }
 const digits=value.replace(/\D/g,'');
 if(digits.length===14&&validCnpj(digits))return push(digits,'cnpj',false),out;
 if(digits.length===11&&validCpf(digits)&&(/\bcpf\b/i.test(value)||!validCnpj(digits.padStart(14,'0'))))return push(digits,'cpf',false),out;
 // GLPI number fields print a CNPJ as 34.347.853.000.116,00 (sometimes without the comma) and drop leading zeros.
 const decimal=value.replace(/,\d{1,2}$/,'').replace(/\D/g,'');
 const candidates=[...new Set([decimal,decimal.endsWith('00')?decimal.slice(0,-2):'',digits])]
  .filter(d=>d.length>=12&&d.length<=14).map(d=>d.padStart(14,'0')).filter(d=>validCnpj(d));
 if(new Set(candidates).size===1)push(candidates[0],'cnpj',true);
 return out;
}
