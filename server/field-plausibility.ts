import {norm} from './processing-extract.js';
import {validCnpj} from './registration-reading.js';
import {validCpf} from './reading-validation.js';

// Form labels that OCR sometimes places in the value position of a neighbouring field.
const labelText=/^(?:data de (?:abertura|constituicao|inscricao(?: no cnpj)?|emissao|nascimento)|bairro(?:\/distrito)?|municipio|uf|cep|logradouro|numero|complemento|nome empresarial|nome de fantasia|titulo do estabelecimento.*|porte|situacao cadastral|natureza juridica.*|telefone|endereco eletronico|cnpj|cpf|final da vigencia|inicio da vigencia|sistema para matricula)$/;
const shapes:Record<string,RegExp>={
 cep:/^\d{5}-?\d{3}$/,
 estado:/^(?:[A-Z]{2}|[\p{L} ]{4,50})$/u,
 numero:/^\d{1,6}[A-Za-z]?$|^s\/?n$/i,
 remuneracao:/^\d{1,3},\d{2}%$/,garantia:/^\d{1,3},\d{2}%$/,repasse:/^\d{1,3},\d{2}%$/,repasseSegundo:/^\d{1,3},\d{2}%$/,cashback:/^\d{1,3},\d{2}%$/,
 valor:/^\d+,\d{2}$/,valorTotal:/^\d+,\d{2}$/,valorParcela:/^\d+,\d{2}$/,cashbackValor:/^\d+,\d{2}$/,
 parcelas:/^\d{1,4}$/,alunos:/^\d{1,6}$/,duracaoMeses:/^\d{1,3}$/,
 inicio:/^\d{4}-\d{2}-\d{2}$/,fim:/^\d{4}-\d{2}-\d{2}$/,dataFormalizacao:/^\d{4}-\d{2}-\d{2}$/,dataAssinaturaMatriz:/^\d{4}-\d{2}-\d{2}$/,
 agencia:/^\d{1,6}(?:-[\dXx])?$/,conta:/^\d{1,15}(?:-?[\dXx])?$/,
};
export const labelLike=(value:string)=>labelText.test(norm(value).replace(/[:.]+$/,''));
/** A value that cannot be what the field holds is a reading artifact, never evidence of an error. */
export function plausibleFieldValue(key:string,value:string) {
 const v=value.trim();if(!v||labelLike(v))return false;
 if(['razaoSocial','nomeFantasia','titularConta'].includes(key)&&/^(?:LTDA|LTD|ME|EPP|EIRELI|S\/?A)(?:[\s.\-]+(?:LTDA|ME|EPP|[A-Z]{2}))*[.\s]*$/i.test(v))return false;
 if(key==='cnpj')return /^[\d.\/\-\s]+$/.test(v)&&(v.replace(/\D/g,'').length===11?validCpf(v):validCnpj(v));
 if(key==='representanteCpf')return validCpf(v);
 if(key==='documentoTitular'){const d=v.replace(/\D/g,'');return /^[\d.\/\-\s]+$/.test(v)&&(d.length===11?validCpf(d):d.length===14&&validCnpj(d));}
 if(shapes[key])return shapes[key].test(v);
 if(['razaoSocial','nomeFantasia','titularConta','representanteNome','cidade','bairro','rua'].includes(key))return /\p{L}{2}/u.test(v)&&v.length<=160;
 return true;
}
// The company operating this portal is the counterparty of every contract, never the school.
const ownCnpjRoot='45543580';
export function ownIdentity(key:string,value:string) {
 if(key==='cnpj')return value.replace(/\D/g,'').startsWith(ownCnpjRoot);
 if(key==='razaoSocial')return /^kedu servicos e solucoes educacionais/.test(norm(value));
 return false;
}
/**
 * Values too specific to coincide with the request by an OCR error: check-digit documents,
 * postal codes, long account numbers and multi-word names. Short numbers and rates are excluded.
 */
export function distinctiveValue(key:string,value:string) {
 const d=value.replace(/\D/g,'');
 if(['cnpj','representanteCpf','documentoTitular'].includes(key))return plausibleFieldValue(key,value);
 if(key==='cep')return d.length===8;
 if(key==='conta')return d.length>=5;
 if(['razaoSocial','nomeFantasia','titularConta','representanteNome','rua','endereco'].includes(key))return value.trim().split(/\s+/).length>=2&&value.replace(/\s/g,'').length>=8;
 if(['cidade','bairro'].includes(key))return value.replace(/[^\p{L}]/gu,'').length>=5;
 return false;
}
