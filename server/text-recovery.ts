import {qualificationFields} from './qualification-reading.js';
import {structuredIdentityFields} from './structured-identities.js';
import {ownIdentity} from './field-plausibility.js';
import {bankFields} from './bank-reading.js';
type Fields=Record<string,string[]>;
/** Fields recoverable from an already extracted text without OCR; existing fields are never replaced. */
export function recoverTextFields(text:string,existing:Fields):Fields {
 const found:Fields={...bankFields(text),...qualificationFields(text,cnpj=>ownIdentity('cnpj',cnpj))};
 for(const [key,values] of Object.entries(structuredIdentityFields(text)))found[key]=[...new Set([...(found[key]||[]),...values])];
 return Object.fromEntries(Object.entries(found).filter(([key,values])=>values.length&&!existing[key]?.length));
}
