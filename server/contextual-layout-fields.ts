import {validCnpj} from './registration-reading.js';
import {fullStateName} from '../shared/state-name.js';
type Fields=Record<string,string[]>;
const unique=(values:string[])=>[...new Set(values.map(v=>v.trim()).filter(Boolean))];
/** Explicit labels only; the GLPI reference is never an input to this recovery. */
export function contextualLayoutFields(text:string):Fields {
 const fields:Fields={};
 // Explicit location label, never a location guessed from a person's birthplace.
 const locations=[...text.matchAll(/(?:^|\n)\s*[*•-]?\s*Localiza[çc][ãa]o\s*:\s*([\p{L}][\p{L} '\-]{1,60}?)\s*[-\/]\s*([A-Z]{2})\s*(?=\n|$)/gu)];
 const validLocations=locations.filter(m=>fullStateName(m[2]));
 if(validLocations.length&&unique(validLocations.map(m=>m[1]+'|'+m[2])).length===1){fields.cidade=[validLocations[0][1].trim()];fields.estado=[fullStateName(validLocations[0][2])!];}
 const names=unique([...text.matchAll(/(?:^|\n)\s*NOME OU RAZ[ÃA]O SOCIAL\s*\n([^\n]{3,160})/gi)].map(m=>m[1]));
 if(names.length===1&&!/NOME FANTASIA|CNPJ|INSCRI[ÇC]/i.test(names[0]))fields.razaoSocial=names;
 // Alvarás place CIDADE and ESTADO in neighbouring cells, away from the address.
 const cities=unique([...text.matchAll(/(?:^|\n)\s*(?:C[OÔ]MPLEMENTO\s*:?\s*)?CIDADE\s+ESTADO\s*\n\s*([\p{L}][\p{L} '\-]{1,65})\s+([A-Z]{2})\s*(?=\n|$)/giu)].map(m=>m[1]));
 const states=unique([...text.matchAll(/(?:^|\n)\s*(?:C[OÔ]MPLEMENTO\s*:?\s*)?CIDADE\s+ESTADO\s*\n\s*[\p{L}][\p{L} '\-]{1,65}\s+([A-Z]{2})\s*(?=\n|$)/giu)].map(m=>m[1]));
 if(cities.length===1)fields.cidade=cities;if(states.length===1)fields.estado=states;
 // A company's seat is distinct from the representative's home and the court.
 const seats=[...text.replace(/\s+/g,' ').matchAll(/(?:com sede|a sociedade (?:tem|ter[áa]|mant[ée]m) (?:a sua |sua )?sede)\s+(?:na|no|em|[àa])?\s*([^;]{8,260}?\bCEP\s*:?\s*\d{2}\.?\d{3}-?\d{3})/gi)].map(m=>m[1]);
 const companySeats=unique(seats.filter(s=>/^(?:rua|avenida|travessa|rodovia|estrada|alameda|pra[çc]a|r\.|av\.)\s/i.test(s)));
 if(companySeats.length===1)fields.endereco=companySeats;
 const places=seats.flatMap(seat=>{
  const m=/,\s*([\p{L}][\p{L} '\-]{1,60}),\s*([\p{L}][\p{L} ]{1,30}),\s*CEP\b/iu.exec(seat);
  if(!m)return [];
  // The abbreviated-UF layout can merge neighbourhood and city into one cell.
  // Leave that layout to the dedicated address parser rather than guessing.
  const state=m[2].trim();if(fullStateName(state))return [];
  const known=Array.from(['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']).map(fullStateName).find(s=>s?.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/^estado (?:de|do|da) /,'')===state.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase());
  return known?[{city:m[1].trim(),state:known}]:[];
 });
 if(places.length&&unique(places.map(p=>p.city.toUpperCase())).length===1&&unique(places.map(p=>p.state)).length===1){fields.cidade=[places[0].city];fields.estado=[places[0].state];}
 // A contractor's header can precede a separate Kedu identification block. Never
 // classify the printed trade name as legal name or adopt the other party's CNPJ.
 const header=text.split(/(?:^|\n)\s*Contrato\s*(?:\n|$)/i)[0];
 if(header!==text&&header.length<1500){
  const ids=unique([...header.matchAll(/\bCNPJ\s*:\s*(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})(?!\d)/gi)].map(m=>m[1]).filter(v=>validCnpj(v)&&!v.replace(/\D/g,'').startsWith('45543580')));
  if(ids.length===1)fields.cnpj=ids;
 }
 return fields;
}
