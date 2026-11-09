import {distinctFieldValues,sameFieldValue} from '../shared/value-comparison.js';
import {htmlToText,extractFields} from './glpi-analysis.js';
import {fieldsFromLines,normalizeValue} from './processing-extract.js';
export function requestCompanyReferences(content:string){
 return [...htmlToText(content).join('\n').matchAll(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\s*\(([^)\n]{3,180})\)/g)].map(m=>({cnpj:m[1],name:m[2].trim()}));
}

/** The form and explicitly labelled observations are the reference, never a guessed value. */
export function requestExpectations(content:string,explicitFields:Record<string,{value:string}>={}){
 const lines=htmlToText(content),form=extractFields(lines);
 const nested=['observacoes','detalhamento'].flatMap(k=>form[k]?[form[k]]:[]);
 const fields=fieldsFromLines([...lines,...nested]);
 // CNPJs with company labels in one cell are separate references, not one malformed number.
 if(fields.cnpj)fields.cnpj=fields.cnpj.flatMap(value=>{
  const ids=[...value.matchAll(/\b(?:\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{14})(?!\d)/g)].map(m=>normalizeValue('cnpj',m[0]));
  return ids.length?ids:[value];
 });
 const listed=String(form.cnpj||'').match(/\b(?:\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{14})(?!\d)/g)||[];
 const companies=requestCompanyReferences(content);
 if(listed.length>1||companies.length>1)fields.cnpj=[...(fields.cnpj||[]),...listed.map(v=>normalizeValue('cnpj',v)),...companies.map(c=>c.cnpj)];
 if(fields.razaoSocial)fields.razaoSocial=fields.razaoSocial.map(value=>value.replace(/^(?:contratante|contratad[ao])\s*:\s*|^(?:contratante|contratad[ao])\s+(?=\S+\s+\S+)/i,'').trim());
 // A CEP inside the requested address is also explicit reference evidence, not a replacement for it.
 for(const address of fields.endereco||[])for(const match of address.matchAll(/\bCEP\s*:?\s*(\d{2}\.?\d{3}-?\d{3})(?!\d)/gi))fields.cep=[...(fields.cep||[]),normalizeValue('cep',match[1])];
 // Labelled numeric values also occur together in a single observations cell.
 const text=nested.join('\n');
 for(const [key,pattern] of [
  ['valor',/\bvalor parcelado\s*:\s*((?:R\$\s*)?(?:\d{1,3}(?:\.\d{3})*|\d+),\d{2})(?!\d)/gi],
  ['remuneracao',/\bremunera[çc][ãa]o kedu\s*:\s*(\d{1,3}(?:[.,]\d{1,2})?\s*%)/gi],
  ['parcelas',/\b(?:qtd\.?|quantidade de|n[úu]mero de) parcelas\s*:\s*(\d+)(?!\d)/gi],
 ] as [string,RegExp][]){
  const matches=[...text.matchAll(pattern)].map(m=>normalizeValue(key,m[1]));
  const shape=key==='valor'?/^\d+,\d{2}$/:key==='remuneracao'?/^\d+,\d{2}%$/:/^\d+$/;
  if(matches.length)fields[key]=[...new Set([...(fields[key]||[]).filter(v=>shape.test(v)),...matches])];
 }
 for(const key of ['cnpj','razaoSocial','remuneracao'])if(!fields[key] && explicitFields[key]?.value)fields[key]=[normalizeValue(key,explicitFields[key].value)];
 return Object.fromEntries(Object.entries(fields).map(([key,values])=>[key,distinctFieldValues(key,values)]));
}
export {sameFieldValue as sameRequestedValue,distinctFieldValues as distinctRequestedValues} from '../shared/value-comparison.js';

type TicketConversation = {
 content: string;
 created?: string;
 followups?: {id?: string; content: string; date?: string; private?: boolean}[];
 documentLinks?: Record<string, string[]>;
 messageAuthors?: Record<string, string>;
};

export function conversationEntries(ticket: TicketConversation) {
 const initial = {id:"initial", date:ticket.created, content:ticket.content};
 const messages = [initial, ...(ticket.followups || []).filter(message => !message.private)];
 return messages.map((message, index) => {
  const id = message.id || "legacy-" + index;
  return {
   id, date:message.date, text:htmlToText(message.content).join('\n'),
   author:ticket.messageAuthors?.[id],
   documents:ticket.documentLinks?.[id] || [],
  };
 });
}

export function conversationText(ticket: TicketConversation) {
 const initial = htmlToText(ticket.content).join('\n');
 const messages = (ticket.followups || []).filter(message => !message.private)
  .map(message => [message.date, ...htmlToText(message.content)].filter(Boolean).join('\n'));
 return [initial, ...messages].filter(Boolean).join('\n\n');
}

// Words with which a message announces that it replaces a value given earlier in the ticket.
const correctionMarker = /\b(?:corre[çc][ãa]o|corrigid[oa]s?|corrigindo|corrigir|retific\w*|correto|correta|na verdade|o certo|a certa|onde se l[êe]|substitu\w*)\b/i;
export type ReferenceCorrection = {previous: string[]; value: string; date?: string; message?: string};
/** Read each message independently so a field label cannot consume the next message.
 * Messages are taken in date order. A message that explicitly corrects a field with a single
 * value replaces the earlier reference, which stays recorded; without that wording the values
 * are kept together, so the reference remains ambiguous for a person to decide. */
export function conversationReferences(ticket: TicketConversation, explicitFields: Record<string,{value:string}> = {}) {
 const fields = requestExpectations(ticket.content, explicitFields), corrections: Record<string, ReferenceCorrection> = {};
 const messages = (ticket.followups || []).map((message, index) => ({message, index})).filter(({message}) => !message.private)
  .sort((a, b) => String(a.message.date || '').localeCompare(String(b.message.date || '')) || a.index - b.index).map(({message}) => message);
 for (const message of messages) {
  const corrects = correctionMarker.test(htmlToText(message.content).join(' '));
  for (const [key, values] of Object.entries(requestExpectations(message.content))) {
   const earlier = fields[key] || [];
   if (corrects && values.length === 1 && earlier.length && earlier.some(v => !sameFieldValue(key, v, values[0]))) {
    corrections[key] = {previous: earlier.filter(v => !sameFieldValue(key, v, values[0])), value: values[0], date: message.date, message: message.id};
    fields[key] = [values[0]];
    continue;
   }
   fields[key] = distinctFieldValues(key, [...earlier, ...values]);
  }
 }
 return {fields, corrections};
}
export function conversationExpectations(ticket: TicketConversation, explicitFields: Record<string,{value:string}> = {}) {
 return conversationReferences(ticket, explicitFields).fields;
}
