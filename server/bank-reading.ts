import {validCnpj} from './registration-reading.js';
import {validCpf} from './reading-validation.js';
type Fields=Record<string,string[]>;
const digits=(s:string)=>s.replace(/\D/g,'');
const documentMask=(d:string)=>d.length===14?`${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`:`${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;
const validDocument=(value:string)=>{const d=digits(value);return d.length===14?validCnpj(d):d.length===11&&validCpf(d);};
const holder=(value:string)=>{const v=value.replace(/\s+/g,' ').replace(/[\s,;.:-]+$/,'').trim();return /\p{L}{2}/u.test(v)&&v.length<=120&&!/^(?:cpf|cnpj|conta|ag[êe]ncia|banco)\b/i.test(v)?v:'';};

/**
 * Bank details written as label blocks ("BANCO: X AGÊNCIA: Y CONTA: Z TITULAR DA CONTA: W CNPJ/CPF: N"),
 * account statements and payment-account declarations. Only explicit labels are read.
 */
export function bankFields(source:string):Fields {
 const result:Fields={};
 const add=(key:string,value:string|undefined)=>{const v=value?.replace(/\s+/g,' ').trim();if(v&&!/preencher|_{3,}|\{\{/i.test(v)&&!(result[key]||=[]).includes(v))result[key].push(v);};
 const text=source.replace(/[ \t]+/g,' ');
 // Inline label block, possibly inside a contract paragraph.
 for(const block of text.matchAll(/\bBANCO\s*:/gi)){
  const part=text.slice(block.index,block.index+420).split(/\n\s*\n/)[0];
  const label=(name:string)=>new RegExp(`\\b${name}\\s*:\\s*([^\\n]*?)\\s*(?=\\b(?:AG[ÊE]NCIA|CONTA(?: CORRENTE)?|TITULAR DA CONTA|CNPJ\\/CPF|CPF\\/CNPJ|PIX|CHAVE PIX)\\s*:|\\n|$)`,'i').exec(part)?.[1];
  const bank=label('BANCO'),agency=label('AG[ÊE]NCIA'),account=label('CONTA(?: CORRENTE)?'),owner=label('TITULAR DA CONTA'),document=label('(?:CNPJ\\/CPF|CPF\\/CNPJ)');
  if(!agency&&!account)continue;
  if(bank&&/\p{L}/u.test(bank))add('banco',bank.replace(/[\s,;.]+$/,''));
  if(agency&&/^\d{1,6}(?:\s*-\s*[\dXx])?$/.test(agency.trim()))add('agencia',agency.replace(/\s/g,''));
  if(account&&/^\d{1,15}(?:\s*-\s*[\dXx])?$/.test(account.trim()))add('conta',account.replace(/\s/g,''));
  if(owner)add('titularConta',holder(owner));
  const number=document&&/^[\d.\/\-\s]{11,20}/.exec(document)?.[0];
  if(number&&validDocument(number))add('documentoTitular',documentMask(digits(number)));
 }
 const lines=text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
 // Payment-account declarations: "Informações do titular da conta / Nome X / CPF Y / Banco 0260 - ... / Agência / Conta".
 const ownerSection=lines.findIndex(l=>/^(?:informa[çc][õo]es do titular|dados do recebedor|dados do titular)\b/i.test(l));
 if(ownerSection>=0){
  const section=lines.slice(ownerSection+1,ownerSection+14);
  const valueOf=(pattern:RegExp)=>{for(let i=0;i<section.length;i++){const m=pattern.exec(section[i]);if(m)return (m[1]||section[i+1]||'').trim();}return '';};
  const name=valueOf(/^Nom[ea]\s*:?\s*(.*)$/i);if(name)add('titularConta',holder(name));
  const document=valueOf(/^(?:CPF\/CNPJ|CNPJ\/CPF|CPF|CNPJ)\s*:?\s*(.*)$/i).replace(/,/g,'.');
  const number=/^[\d.\/\-\s]{11,20}/.exec(document)?.[0];if(number&&validDocument(number))add('documentoTitular',documentMask(digits(number)));
  const bank=valueOf(/^Banco\s*:?\s*(.+)$/i).split(/\s+-\s+Institui/i)[0];if(bank)add('banco',bank);
  const agency=/^\d{1,6}(?:-[\dXx])?$/.exec(valueOf(/^Ag[êe]ncia\s*:?\s*(.*)$/i))?.[0];if(agency)add('agencia',agency);
  const account=/^\d{1,15}-?[\dXx]?$/.exec(valueOf(/^Conta\s*:?\s*(\d.*)$/i).replace(/\s/g,''))?.[0];if(account)add('conta',account);
 }
 // Account statements: "Cliente: NAME" followed by "Agência: X / Conta: Y".
 for(let i=0;i<lines.length-1;i++){
  const client=/^Cliente\s*:\s*(.+)$/i.exec(lines[i]);
  if(client&&/Ag[êe]ncia\s*:?\s*\d/i.test(lines[i+1]+' '+(lines[i+2]||'')))add('titularConta',holder(client[1].replace(/\s+[A-Z]{1,3}$/,'')));
 }
 return Object.fromEntries(Object.entries(result).map(([k,v])=>[k,v.filter(Boolean)]).filter(([,v])=>v.length));
}
