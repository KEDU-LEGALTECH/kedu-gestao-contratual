export type ContractParty={role:string;name:string;cnpj:string;excerpt:string};
const canon=(s:string)=>s.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const mask=(s:string)=>{const d=s.replace(/\D/g,'');return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;};
/** Only explicit party declarations are considered, never witnesses or arbitrary CNPJs. */
export function extractContractParties(text:string):ContractParty[] {
 const pattern=/(?:^|\n)\s*(CONTRATANTE|CONTRATAD[AO]|CEDENTE|CESSION[ÁA]RI[AO]|INSTITUI[ÇC][ÃA]O DE ENSINO)\s*:\s*/gi;
 const declarations=[...text.matchAll(pattern)],parties:ContractParty[]=[];
 for(let i=0;i<declarations.length;i++){
  const match=declarations[i],start=match.index!+match[0].length;
  const block=text.slice(start,Math.min(declarations[i+1]?.index??text.length,start+1800));
  const ids=[...block.matchAll(/\bCNPJ(?:\/(?:MF|ME))?\s*(?:sob\s*(?:o\s*)?)?(?:n[º°o.]?\s*)?[:\s]*(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})(?!\d)/gi)].map(m=>mask(m[1]));
  const unique=[...new Set(ids)];if(unique.length!==1)continue;
  const named=/(?:^|\n)\s*(?:NOME|RAZ[ÃA]O SOCIAL|NOME EMPRESARIAL)\s*:\s*([^\n]+)/i.exec(block)?.[1];
  const first=block.split('\n').map(s=>s.trim()).find(Boolean)||'';
  const name=(named||first).split(/,\s*(?:pessoa jur[íi]dica|inscrit[ao]|com sede)|\s+CNPJ\b/i)[0].replace(/[;,\s]+$/,'').trim();
  if(name.length<3||name.length>200||/^(?:CNPJ|ENDERE[ÇC]O)\b/i.test(name))continue;
  const party={role:match[1].toUpperCase(),name,cnpj:unique[0],excerpt:block.slice(0,500).trim()};
  if(!parties.some(p=>canon(p.name)===canon(name)&&p.cnpj===party.cnpj))parties.push(party);
 }
 return parties;
}
export function selectContractParty(parties:ContractParty[],expectedCnpj?:string) {
 if(!parties.length)return null;
 const matching=expectedCnpj?parties.filter(p=>canon(p.cnpj)===canon(expectedCnpj)):[];
 if(matching.length===1)return matching[0];
 if(matching.length>1)return null;
 const counterpart=parties.filter(p=>!/^kedu\b/i.test(p.name));
 // A unique, explicitly identified counterparty can expose a real CNPJ mismatch.
 return counterpart.length===1?counterpart[0]:null;
}
export function scopePartyReading<T extends {text:string;fields:Record<string,string[]>}>(reading:T,expectedCnpj?:string):{reading:Omit<T,'fields'>&{text:string;fields:Record<string,string[]>};parties:ContractParty[];selected:ContractParty|null} {
 const parties=extractContractParties(reading.text),selected=selectContractParty(parties,expectedCnpj);
 if(!parties.length)return {reading,parties,selected};
 const fields={...reading.fields};delete fields.cnpj;delete fields.razaoSocial;
 if(selected){fields.cnpj=[selected.cnpj];fields.razaoSocial=[selected.name];}
 return {reading:{...reading,fields},parties,selected};
}
