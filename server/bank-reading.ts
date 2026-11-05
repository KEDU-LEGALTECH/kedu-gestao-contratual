import {validCnpj} from './registration-reading.js';
import {validCpf} from './reading-validation.js';
type Fields=Record<string,string[]>;
const digits=(s:string)=>s.replace(/\D/g,'');
const documentMask=(d:string)=>d.length===14?`${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`:`${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;
const validDocument=(value:string)=>{const d=digits(value);return d.length===14?validCnpj(d):d.length===11&&validCpf(d);};
const holder=(value:string)=>{const v=value.replace(/\s+/g,' ').replace(/[\s,;.:-]+$/,'').trim();return /\p{L}{2}/u.test(v)&&v.length<=120&&!/^(?:cpf|cnpj|conta|ag[êe]ncia|banco)\b/i.test(v)?v:'';};
/** Sicoob cheque header: Comp / Banco / Cooperativa / C1 / Conta.
 * The serial number, cheque number and payer data are never account values. */
export function sicoobChequeFields(source:string):Fields{
 if(!/\bSICOOB\b/i.test(source)||!/Banco\s+Cooperativa\s+C1\s+Conta/i.test(source)||!/Pague por este|Cheque a quantia/i.test(source))return {};
 const rows=[...source.matchAll(/\b\d{3}\s+(756)\s+(\d{4})\s+\d\s+(\d{4,15}-[\dXx])(?=\s|$)/g)];
 const pairs=[...new Set(rows.map(m=>m[2]+'|'+m[3]))];if(pairs.length!==1)return {};
 const [agency,account]=pairs[0].split('|');const fields:Fields={banco:['756'],agencia:[agency],conta:[account]};
 const names=[...new Set([...source.matchAll(/(?:^|\n)SICOOB[^\n]{0,50}?\b((?:COL[ÉE]GIO|ESCOLA|INSTITUTO|CENTRO EDUCACIONAL|ASSOCIA[ÇC][ÃA]O) [^\n]{3,100}?\b(?:LTDA|EIRELI|ME))\s*(?=\n|$)/gi)].map(m=>holder(m[1])).filter(Boolean))];
 const ids=[...new Set([...source.matchAll(/\bCNPJ[.:\s]*(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})(?!\d)/gi)].map(m=>m[1]).filter(validDocument))];
 if(names.length===1&&ids.length===1){fields.titularConta=names;fields.documentoTitular=ids;}
 return fields;
}
/** A transfer receipt explicitly separates the receiver from the payer. */
export function receiverBankFields(source:string):Fields|null {
 const sections=[...source.matchAll(/(?:^|\n)\s*Recebedor\s*:?\s*\n([\s\S]{10,650}?)(?=\n\s*Pagador\s*:?\s*\n)/gi)];
 if(!sections.length)return null;
 const fields:Fields={};const add=(key:string,value:string)=>{if(value&&!(fields[key]||=[]).includes(value))fields[key].push(value);};
 for(const section of sections){const text=section[1],name=holder(text.split('\n')[0]);
  const document=/(?:^|\n)\s*(?:CPF|CNPJ)\s*:?\s*\n\s*([\d.\/-]+)\s*(?=\n|$)/i.exec(text)?.[1];
  const agency=/(?:^|\n)\s*Ag[êe]ncia\s*:?\s*\n\s*(\d{1,6}(?:-[\dXx])?)\s*(?=\n|$)/i.exec(text)?.[1];
  const account=/(?:^|\n)\s*Conta\s*[:|]?\s*\n\s*(\d{1,15}(?:-[\dXx])?)\s*(?=\n|$)/i.exec(text)?.[1];
  const bank=/(?:^|\n)\s*Institui[çc][ãa]o\s*:?\s*\n\s*([^\n]+)/i.exec(text)?.[1];
  if(!name||!document||!validDocument(document)||!agency||!account||!bank)continue;
  add('titularConta',name);add('documentoTitular',documentMask(digits(document)));add('agencia',agency);add('conta',account);add('banco',bank.trim());
 }
 // Conflicting receiver sections are not collapsed to the convenient alternative.
 return Object.keys(fields).length&&Object.values(fields).every(v=>v.length===1)?fields:null;
}
export function bankAccountSection(text:string){
 const match=/(?:^|\n)\s*Dados banc[áa]rios(?:[ \t]+Copiar todos)?[ \t]*:?[ \t]*\n/i.exec(text);if(!match)return '';
 return text.slice(match.index+match[0].length).split(/\n\s*(?:Chaves Pix|Dados pessoais|Hist[óo]rico|Observa[çc][õo]es|Assinatura)\b/i)[0].split(/\r?\n/).slice(0,30).join('\n');
}

/**
 * Bank details written as label blocks ("BANCO: X AGÊNCIA: Y CONTA: Z TITULAR DA CONTA: W CNPJ/CPF: N"),
 * account statements and payment-account declarations. Only explicit labels are read.
 */
export function bankFields(source:string):Fields {
 const receiver=receiverBankFields(source);if(receiver)return receiver;
 const cheque=sicoobChequeFields(source);if(Object.keys(cheque).length)return cheque;
 const result:Fields={};
 const add=(key:string,value:string|undefined)=>{const v=value?.replace(/\s+/g,' ').trim();if(v&&!/preencher|_{3,}|\{\{/i.test(v)&&!(result[key]||=[]).includes(v))result[key].push(v);};
 const text=source.replace(/[ \t]+/g,' ');
 // An account can be identified in a corporate attachment or judicial annex.
 // Require the named account owner and the account/agency/bank in one clause.
 for(const m of text.matchAll(/conta\s+empresarial\s+da\s+(?:pessoa\s+jur[íi]dica\s+)?([\p{L}][\p{L} .&'\-]{3,160}?)\s*,\s*de\s+n[.º°o\s]*\s*(\d[\d.]{0,17}-[\dXx])\s*,\s*Ag\.?\s*(\d{1,6}-[\dXx])\s*,\s*(Banco\s+do\s+Brasil|Sicredi|Sicoob|Santander|Bradesco|Ita[úu]|Nubank)\b/giu)){
  add('titularConta',m[1]);add('conta',m[2].replace(/\./g,''));add('agencia',m[3]);add('banco',m[4]);
 }
 // A Sicredi account card labels its holder as Associado. Cooperativa is
 // preserved as context and is not silently converted into an agency number.
 if(/\bSicredi\b/i.test(text)&&/(?:^|\n)\s*Cooperativa\s*:\s*\d{1,6}\b/i.test(text)){
  const names=[...text.matchAll(/(?:^|\n)\s*Associad[oa]\s*:\s*([^\n]+)/gi)].map(m=>m[1].trim());
  const accounts=[...text.matchAll(/(?:^|\n)\s*Conta\s*:\s*(\d{1,15}-[\dXx])\s*(?=\n|$)/gi)].map(m=>m[1]);
  if(names.length&&accounts.length&&new Set(names).size===1&&new Set(accounts).size===1){add('banco','Sicredi');add('titularConta',names[0]);add('conta',accounts[0]);}
 }
 // Caixa's company-account PDF prints the actual account in the navigation
 // header. The Pix payload also includes branch/operation digits: never parse
 // that combined value as the account, or use the greeting as its holder.
 if(/https:\/\/gerenciador\.caixa\.gov\.br\/empresa\//i.test(text)&&/Dados do Recebedor/i.test(text)&&!/\bPagador\b/i.test(text)){
  const agencies=[...text.matchAll(/(?:^|\n)\s*Ag[êe]ncia\s*:\s*(\d{1,6})(?!\d)/gi)].map(m=>m[1]);
  const accounts=[...text.matchAll(/(?:^|\n)\s*Conta\s*:\s*(\d{1,15}-[\dXx])(?![\d-])/gi)].map(m=>m[1]);
  if(agencies.length&&accounts.length&&new Set(agencies).size===1&&new Set(accounts).size===1){
   add('banco','Caixa Econômica Federal');add('agencia',agencies[0]);add('conta',accounts[0]);
  }
 }
 // Cora business-account headers identify the institution explicitly. Keep the
 // printed company display name separate from legal holder identification.
 if(!/\b(?:pagador|recebedor|remetente|destinat[áa]rio)\b/i.test(text)&&/(?:^|\n)\s*Cora\s+SCF[Iil]\s*-\s*403\s*(?=\n|$)/i.test(text)){
  const pairs=[...text.matchAll(/\bAg\.?\s*(\d{1,6}(?:-[\dXx])?)\s*[-·•|]?\s*c\/c\s*(\d{1,15}-[\dXx])(?!\d)/gi)];
  if(pairs.length&&new Set(pairs.map(m=>m[1]+'|'+m[2])).size===1){add('banco','Cora');add('agencia',pairs[0][1]);add('conta',pairs[0][2]);}
 }
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
 // A statement's repeated watermark can lose spaces in OCR. Require a statement,
 // agency/account labels and the full bank name; "Brasil" alone is not evidence.
 if(/extrato de conta corrente/i.test(text)&&/ag[êe]ncia\s*:?\s*\d/i.test(text)&&/conta\s*:?\s*\d/i.test(text)&&/BANCODOBRASIL|BANCO DO BRASIL/i.test(text))add('banco','Banco do Brasil');
 // Mobile business-account headers: an explicit bank brand and one Ag/Cc pair.
 // Do not adopt the greeting/user name as account holder, or mix transfer parties.
 if(!/\b(?:pagador|recebedor|remetente|destinat[áa]rio)\b/i.test(text)){
  const pairs=[...text.matchAll(/\bAg\.?\s*:?\s*(\d{1,6}(?:-[\dXx])?)\s*(?:[-·•«|]\s*)*Cc\.?\s*:?\s*(\d{1,15}(?:-[\dXx])?)(?!\d)/gi)];
  if(pairs.length&&new Set(pairs.map(m=>m[1]+'|'+m[2])).size===1){
   add('agencia',pairs[0][1]);add('conta',pairs[0][2]);
   if(/\b(?:Acessar conta|Saldo)\b/i.test(text)){
    const names=pairs.map(m=>{
     const lead=text.slice(0,m.index),lineStart=lead.lastIndexOf('\n'),prefix=lead.slice(lineStart+1);
     const before=/^[\s()O0•«·-]{0,10}$/.test(prefix)?(lead.slice(0,lineStart).split(/\r?\n/).filter(l=>l.trim()).at(-1)||'').replace(/^[^\p{L}]+/u,'').trim():'';
     return /\b(?:LTDA|ME|EPP|EIRELI|S\/?A)\.?$/i.test(before)&&!/[?:]/.test(before)?holder(before):'';
    }).filter(Boolean);
    if(names.length===pairs.length&&new Set(names.map(n=>n.toUpperCase())).size===1)add('titularConta',names[0]);
   }
   const brands=[...text.matchAll(/(?:^|\n)[^\p{L}\n]{0,8}(Santander|Ita[úu]|Bradesco|Nubank|Banco do Brasil)(?:\s+Empresas)?\s*(?:\d)?\s*(?=\n|$)/giu)].map(m=>m[1]);
   if(new Set(brands.map(b=>b.toLowerCase())).size===1)add('banco',brands[0]);
  }
 }
 // Screenshots put CNPJ under Dados bancários, separately from the Pix key above it.
 const section=bankAccountSection(text).split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
 const mixedParties=section.some(line=>/\b(?:pagador|remetente|destinat[áa]rio|benefici[áa]rio|conta de origem)\b/i.test(line));
 for(let i=0;i<section.length;i++){
  const document=/^(?:CPF\s*\/\s*CNPJ|CNPJ\s*\/\s*CPF|CNPJ|CPF)\s*:?\s*(.*)$/i.exec(section[i]);
  if(document&&!mixedParties){const value=document[1]||section[i+1]||'';if(validDocument(value)&&/^[\d.\/\-\s]+$/.test(value))add('documentoTitular',documentMask(digits(value)));}
  const owner=/^(?:Nome do titular|Titular da conta|Titular)\s*:?\s*(.*)$/i.exec(section[i]);
  if(owner)add('titularConta',holder(owner[1]||section[i+1]||''));
 }
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

