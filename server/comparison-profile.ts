import {norm} from './processing-extract.js';
import {validCnpj} from './registration-reading.js';
type ProfileFile={name:string;text:string;problem?:string;incomplete?:boolean;method?:string};
const identity=['razaoSocial','cnpj','nomeFantasia','endereco','rua','numero','bairro','cep','cidade','estado','representanteNome','representanteCpf'];
const bank=['banco','agencia','conta','titularConta','documentoTitular','pix'];
export const templateDocument=(text:string)=>(text.match(/\{\{\s*[\w.]+\s*\}\}|<%\w+%>/g)||[]).length>=3;
const educational=(type:string)=>/contrato educacional|termo de aceite|pais x escola/.test(norm(type));
// School × parents contract: tuition paid by the guardian for a student; Kedu is not a party at the top (only the cession clause names it).
export const parentsContract=(text:string)=>{const t=norm(text.slice(0,60000));return !/kedu servicos e solucoes/.test(t.slice(0,5000))&&/anuidade/.test(t)&&/\b(?:aluno|educando)/.test(t)&&/contratante|responsavel financeiro/.test(t);};

/**
 * Why a requested field that was not found cannot be expected in the documents of this demand.
 * Only used for absent values: a value that was read is always compared.
 */
export function notApplicableReason(type:string,key:string,files:ProfileFile[]) {
 const t=norm(type),readable=files.filter(f=>!f.problem);
 if(/descredenciamento/.test(t)&&!['razaoSocial','cnpj'].includes(key))return 'No descredenciamento, o relatório identifica a escola pelo nome e CNPJ; este dado não é conferido no documento.';
 if(![...identity,...bank].includes(key))return '';
 if(readable.length&&readable.every(f=>templateDocument(f.text)))return 'Os documentos recebidos são modelos com marcadores ({{…}}), sem dados preenchidos; este dado não consta neles.';
 if(educational(type)&&readable.some(f=>parentsContract(f.text)))return 'Contrato da escola com os responsáveis: confere-se a cláusula de cessão à Kedu, não os dados cadastrais da escola.';
 return '';
}

const cession=/cess[ãa]o[^.;]{0,220}\bkedu\b|\bkedu\b[^.;]{0,220}(?:cess[ãa]o|cr[ée]ditos|cobran[çc]a dos valores)/i;
const genericCession=/cess[ãa]o de (?:receb[íi]veis|cr[ée]ditos)|ceder[^.;]{0,120}(?:cr[ée]ditos|receb[íi]veis)[^.;]{0,120}terceiros/i;
/** Contracts between school and parents must allow the receivables to be assigned to Kedu. */
export function cessionClauseCheck(type:string,files:ProfileFile[]) {
 if(!educational(type))return null;
 const readable=files.filter(f=>!f.problem&&f.text.trim()&&parentsContract(f.text));
 if(!readable.length)return null;
 const hit=readable.map(f=>({f,m:cession.exec(f.text)})).find(x=>x.m);
 // A generic assignment-to-third-parties clause may cover Kedu, but a person must confirm it.
 const generic=hit?undefined:readable.map(f=>({f,m:genericCession.exec(f.text)})).find(x=>x.m);
 if(generic)return {field:'clausulaCessao',label:'Cláusula de cessão de créditos à Kedu',expected:'Presente no contrato',found:'Cessão genérica a terceiros',source:generic.f.name+' — '+generic.f.text.slice(Math.max(0,generic.m!.index-60),generic.m!.index+260).replace(/\s+/g,' ').trim(),
  status:'review',message:'O contrato permite ceder os créditos a terceiros, mas não cita a Kedu. Confirme se a redação atende ou se a cláusula específica deve ser incluída.'};
 const complete=readable.every(f=>!f.incomplete&&!/OCR/.test(f.method||''));
 const excerpt=hit?hit.f.text.slice(Math.max(0,hit.m!.index-120),hit.m!.index+hit.m![0].length+80).replace(/\s+/g,' ').trim():'';
 return {field:'clausulaCessao',label:'Cláusula de cessão de créditos à Kedu',expected:'Presente no contrato',found:hit?'Presente':'',source:hit?hit.f.name+' — '+excerpt:'',
  status:hit?'matches':complete?'different':'missing',
  message:hit?'':complete?'A cláusula que autoriza a cessão dos créditos à Kedu não foi encontrada no contrato. Inclua a cláusula antes de prosseguir.':'A leitura dos documentos não é completa; confira no original se a cláusula de cessão à Kedu está presente.'};
}

/** Settlement reports name the school above its CNPJ ("COLEGIO X: JULHO/2026" / "49.172.814/0001-00"). */
export function reportIdentity(text:string) {
 const lines=text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean).slice(0,40);
 for(let i=1;i<lines.length;i++){
  if(/^PLANILHA:/i.test(lines[i]))break;
  if(!/^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/.test(lines[i])||!validCnpj(lines[i]))continue;
  const d=lines[i].replace(/\D/g,''),cnpj=`${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
  const name=lines[i-1].replace(/\s*:\s*(?:[\p{L}]+\/\d{4}|janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)$/iu,'').trim();
  return {cnpj,razaoSocial:/\p{L}{3}/u.test(name)&&!/^\[/.test(name)?name:''};
 }
 return null;
}
