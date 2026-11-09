import {receiverBankFields} from './bank-reading.js';
import {validCnpj} from './registration-reading.js';
export type ContractParty={role:string;name:string;cnpj:string;excerpt:string;aliases?:string[]};
const canon=(s:string)=>s.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const mask=(s:string)=>{const d=s.replace(/\D/g,'');return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;};

/** A running preamble can qualify each company without a "CONTRATANTE:" label. */
function preambleParties(text:string):ContractParty[]{
 const intro=/\b(?:pelo presente\s+(?:instrumento|contrato)[^;]{0,180}?\b(?:as partes|de um lado)|celebrad[oa]\s+entre\s*,?\s*de um lado)\s*[:,]?\s*/i.exec(text.slice(0,4000));
 if(!intro)return [];
 const start=intro.index+intro[0].length;
 const parties:ContractParty[]=[];
 for(const paragraph of text.slice(start,start+4200).split(';')){
  const block=paragraph.trim().replace(/^(?:(?:e\s*,?\s*)?de outro lado\s*[:,]?\s*)?(?:\d{1,2}\s*[.)]\s*)?/i,'');
  const qualification=/^([^,;]{3,180}),\s*(?:com\s+(?:sede|endere[çc]o)|sociedade\b|pessoa jur[íi]dica\b|inscrit[ao]\s+no\s+CNPJ)/i.exec(block);
  if(!qualification)break;
  const ids=[...block.matchAll(/\bCNPJ\s*(?:\/\s*(?:MF|ME))?\s*(?:sob\s+(?:o\s+)?)?(?:n\s*[º°o.]?\s*)?[:\s]*(\d{2}\.?\d{3}\.?\d{3}\s*\/?\s*\d{4}\s*[-–—]?\s*\d{2})(?!\d)/gi)];
  if(ids.length!==1||!validCnpj(ids[0][1].replace(/\D/g,'')))break;
  const roleName='COL[ÉE]GIO|ESCOLA|CONTRATANTE|CONTRATAD[AO]|CEDENTE|CESSION[ÁA]RI[AO]';
  const roleLabel=new RegExp(`\\(\\s*["“]?(${roleName})["”]?\\s*\\)\\s*$`,'i');
  const nameWithRole=qualification[1].replace(/\s+/g,' ').trim();
  const printedName=nameWithRole.replace(roleLabel,'').trim();
  const legalName=/^(.+?\b(?:LTDA\.?|LIMITADA|S\s*\.\s*A\.?|EIRELI|S\s*\/\s*A))(?:\s+[-–—]\s+(?:COL[ÉE]GIO|ESCOLA)\b.+)?$/i.exec(printedName)?.[1];
  if(!legalName)break;
  const label=(roleLabel.exec(nameWithRole)||roleLabel.exec(block))?.[1];
  parties.push({role:label?.toUpperCase()||'qualificada no preâmbulo',name:legalName,cnpj:mask(ids[0][1]),excerpt:block.slice(0,ids[0].index!+ids[0][0].length)});
 }
 // Require separate qualification blocks so a stray CNPJ in the body cannot become a party.
 return parties.length>=2?parties:[];
}

/** Only explicit party declarations are considered, never witnesses or arbitrary CNPJs. */
export function extractContractParties(text:string):ContractParty[] {
 const pattern=/(?:^|\n)\s*(CONTRATANTE|CONTRATAD[AO]|CEDENTE|CESSION[ÁA]RI[AO]|INSTITUI[ÇC][ÃA]O DE ENSINO|ANUENTE(?:\s*\/\s*PALESTRANTE)?|PALESTRANTE|AGENTE|INTERVENIENTE(?:\s+ANUENTE)?)\s*:\s*/gi;
 const declarations=[...text.matchAll(pattern)],parties:ContractParty[]=[];
 for(let i=0;i<declarations.length;i++){
  const match=declarations[i],start=match.index!+match[0].length;
  // Auxiliary roles end the previous qualification without becoming the contracting party.
  if(/^(?:anuente|palestrante|agente|interveniente)/i.test(match[1]))continue;
  const block=text.slice(start,Math.min(declarations[i+1]?.index??text.length,start+1800)).split(/\n\s*(?:DADOS (?:DE PAGAMENTO|BANC[ÁA]RIOS)|OBSERVA[ÇC][ÕO]ES|CL[ÁA]USULA|OBJETO DO CONTRATO)\s*[:\-]/i)[0];
  const ids=[...block.matchAll(/\bCNPJ(?:\/(?:MF|ME))?\s*(?:sob\s*(?:o\s*)?)?(?:n[º°o.]?\s*)?[:\s]*(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})(?!\d)/gi)].map(m=>mask(m[1]));
  if(!ids.length){
   const personal=/^\s*([^\n]+)\n\s*CPF\s*(?:n[º°o.]?\s*)?[:\s]*(\d{3}\.?\d{3}\.?\d{3}-?\d{2})(?!\d)/i.exec(block);
   if(personal&&!/\b(?:LTDA|EIRELI|SOCIEDADE|REPRESENTANTE|CNPJ)\b/i.test(personal[1]))ids.push(personal[2]);
  }
  const unique=[...new Set(ids)];if(unique.length!==1)continue;
  const named=/(?:^|\n)\s*(?:NOME|RAZ[ÃA]O SOCIAL|NOME EMPRESARIAL)\s*:\s*([^\n]+)/i.exec(block)?.[1];
  const first=block.split(/\s*(?:,?\s*inscrit[ao]\b|\bCNPJ\b|\bCPF\b)/i)[0].replace(/\s+/g,' ').trim();
  const name=(named||first).split(/,\s*(?:pessoa jur[íi]dica|inscrit[ao]|com sede)|\s+CNPJ\b/i)[0].replace(/[;,\s]+$/,'').trim();
  if(name.length<3||name.length>200||/^(?:CNPJ|ENDERE[ÇC]O)\b/i.test(name))continue;
  const party:ContractParty={role:match[1].toUpperCase(),name,cnpj:unique[0],excerpt:block.slice(0,500).trim()};
  if(!parties.some(p=>canon(p.name)===canon(name)&&p.cnpj===party.cnpj))parties.push(party);
 }
 // Explicit first-person alias declaration, not a name guessed from GLPI.
 const people=parties.filter(p=>p.cnpj.replace(/\D/g,'').length===11);
 const aliases=[...text.matchAll(/aceit[oa]\s+por\s+mim\s*\(\s*([^()\n]{3,80})\s*\)/gi)].map(m=>m[1].trim());
 if(people.length===1&&aliases.length===1)people[0].aliases=aliases;
 return parties.length?parties:preambleParties(text);
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
 const receiver=receiverBankFields(reading.text);if(receiver)reading={...reading,fields:{...reading.fields,...receiver}};
 const parties=extractContractParties(reading.text),selected=selectContractParty(parties,expectedCnpj);
 if(!parties.length)return {reading,parties,selected};
 const fields={...reading.fields};delete fields.cnpj;delete fields.razaoSocial;
 if(selected){fields.cnpj=[selected.cnpj];fields.razaoSocial=[selected.aliases?.length===1?selected.aliases[0]:selected.name];}
 return {reading:{...reading,fields},parties,selected};
}
