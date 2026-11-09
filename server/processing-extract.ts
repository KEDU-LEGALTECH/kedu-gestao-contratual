import { contractParagraphs } from "./attachment-analysis.js";
import { fieldLabels,officialInputs,derivedFrom } from "../shared/official-fields.js";
import PizZip from "pizzip";
import { DOMParser } from "@xmldom/xmldom";
import {structuredIdentityFields} from './structured-identities.js';
import {qualificationFields} from './qualification-reading.js';
import {bankFields} from './bank-reading.js';
import {ownIdentity,labelLike} from './field-plausibility.js';
import {sameFieldValue} from '../shared/value-comparison.js';
export const inputLabels:Record<string,string>={...fieldLabels,...officialInputs,endereco:"Endereço",modalidade:"Modalidade de garantia",matriz:"Contrato matriz",motivo:"Descrição da solicitação",valorTotal:'Valor total',valorParcela:'Valor da parcela'};
export const editableKeys=Object.keys(inputLabels).filter(k=>k!=="aditivo");
export const norm=(s:string)=>s.normalize("NFD").replace(/\p{Diacritic}/gu,"").toLowerCase().replace(/\s+/g," ").trim();
const aliases:Record<string,string[]>={
 cnpj:["CNPJ","CNPJ da contratante","NÚMERO DE INSCRIÇÃO","CNPJ Nº"],razaoSocial:["RAZÃO SOCIAL","Razão social da contratante","NOME EMPRESARIAL"],nomeFantasia:["NOME FANTASIA","TÍTULO DO ESTABELECIMENTO (NOME DE FANTASIA)","TÍTULO DO ESTABELECIMENTO / NOME DE FANTASIA"],
 garantia:["PERCENTUAL DE GARANTIA"],repasse:["PERCENTUAL DE REPASSE"],valor:["VALOR DE REFERÊNCIA","VALOR CONTRATUAL","VALOR PARCELADO"],
 parcelas:["QTD PARCELAS","QTD. PARCELAS","QUANTIDADE DE PARCELAS","NÚMERO DE PARCELAS","Nº. DE PARCELAS","Nº DE PARCELAS"],
 endereco:["ENDEREÇO","ENDEREÇO COMPLETO"],rua:["RUA","LOGRADOURO","RUA / LOGRADOURO"],estado:["ESTADO","UF"],cidade:["MUNICÍPIO"],
 inicio:["INÍCIO DA VIGÊNCIA","DATA DE INÍCIO","INÍCIO"],fim:["FIM DA VIGÊNCIA","DATA FINAL","TÉRMINO DA VIGÊNCIA"],
 dataFormalizacao:["DATA DE FORMALIZAÇÃO"],dataAssinaturaMatriz:["DATA DE ASSINATURA DA MATRIZ","DATA DE ASSINATURA DO CONTRATO MATRIZ"],
 representanteNome:["REPRESENTANTE LEGAL","NOME DO REPRESENTANTE"],representanteCpf:["CPF DO REPRESENTANTE"],
 titularConta:["TITULAR DA CONTA","TITULARIDADE","NOME DO TITULAR"],documentoTitular:["CPF/CNPJ DO TITULAR","CNPJ/CPF","CNPJ DO TITULAR","CPF DO TITULAR"],modalidade:["MODALIDADE","MODALIDADE DE GARANTIA"],
 agencia:["AGÊNCIA","AG.","AG"],conta:["CONTA CORRENTE","C/C","CC.","CC"],
 remuneracao:["TAXA","TAXA KEDU","Taxa de remuneração","REMUNERAÇÃO","REMUNERAÇÃO KEDU","REMUNERAÇÃO KEDU (%)"],
 alunos:["ALUNADO","QUANTIDADE DE ALUNOS"],
};
for(const k of editableKeys)aliases[k]=[...(aliases[k]||[]),inputLabels[k]];
const index=Object.entries(aliases).flatMap(([key,names])=>names.map(name=>({key,name:norm(name)}))).sort((a,b)=>b.name.length-a.name.length);
export const fieldKeyForLabel=(label:string)=>index.find(x=>x.name===norm(label.replace(/[:\s]+$/,'')))?.key;
export function mergeExtractedFields(target:Record<string,string[]>,extra:Record<string,string[]>) {
 for(const [key,values]of Object.entries(extra))for(const value of values)if(!(target[key]||=[]).some(v=>sameFieldValue(key,v,value)))target[key].push(value);
 return target;
}
/** Supports label/value cells and a header row followed by its values. */
export function fieldsFromRows(rows:string[][]) {
 const fields:Record<string,string[]>={};
 const merge=(label:string,value:string)=>{
  const key=fieldKeyForLabel(label);if(!key||!value.trim()||fieldKeyForLabel(value))return;
  const values=fieldsFromLines([label.replace(/[:\s]+$/,'')+': '+value]);
  for(const [name,vs]of Object.entries(values))for(const v of vs)if(!(fields[name]||=[]).includes(v))fields[name].push(v);
 };
 for(let i=0;i<rows.length;i++){
  const row=rows[i];
  if(row.length>1&&row.every(cell=>!!fieldKeyForLabel(cell))&&rows[i+1]?.length===row.length&&!rows[i+1].some(cell=>!!fieldKeyForLabel(cell))){row.forEach((label,column)=>merge(label,rows[i+1][column]));i++;continue;}
  for(let j=0;j<row.length-1;j++)if(fieldKeyForLabel(row[j])){merge(row[j],row[j+1]);j++;}
 }
 return fields;
}
export function normalizeValue(key:string,value:string) {
 let s=value.trim().replace(/^[:\s]+/,"");
 if(key==='banco')s=s.split(/\s+(?:Ocorrer[áa]\s+em|O\s+pagamento\s+ser[áa]|Datas\s+e\s+Porcentagens)\b/i)[0].trim();
 if(key==='cidade')s=s.split(/\s+(?:UF|ESTADO|INSCRI[ÇC][ÃA]O MUNICIPAL|CEP)\s*:/i)[0].trim();
 if(['banco','agencia','conta'].includes(key))s=s.replace(/[.,:;]+\s*$/,'').trim();
 if(!s || /^[_\s.\-–—]+$/.test(s) || /\{[^}]+\}|\[(?:DADO|NOME|PREENCHER)|PENDENTE|⟨/i.test(s))return "";
 if(["remuneracao","garantia","repasse","repasseSegundo","cashback"].includes(key)) {const m=/^(\d{1,3})(?:[.,](\d{1,2}))?\s*%$/.exec(s);if(m)s=Number(m[1])+","+(m[2]||"").padEnd(2,"0")+"%";}
 if(key==="modalidade"){const known=["Garantia Completa","Garantia Conjunta","Garantia Prevista"].find(x=>norm(x)===norm(s));if(known)s=known;}
 // A document number followed by the next sentence ("07438321000111 Ocorrerá em...") keeps only the number.
 if(["cnpj","representanteCpf","documentoTitular"].includes(key)){const lead=/^(\d[\d.\/\-\s]{9,20}\d)\s+\p{L}/u.exec(s);if(lead&&[11,14].includes(lead[1].replace(/\D/g,"").length))s=lead[1];}
 if(key==="cnpj"){const d=s.replace(/\D/g,"");if(d.length===14)s=`${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;}
 if(key==="cep" && /^\d{2}\.?\d{3}-?\d{3}$/.test(s)){const d=s.replace(/\D/g,"");s=d.slice(0,5)+"-"+d.slice(5);}
 if(["valor","cashbackValor","valorTotal","valorParcela"].includes(key) && /^(?:R\$\s*)?(?:\d{1,3}(?:\.\d{3})*|\d+),\d{2}$/.test(s))s=s.replace(/R\$|\s|\./g,"");
 if(["representanteCpf","documentoTitular"].includes(key)){const d=s.replace(/\D/g,"");if(d.length===11)s=`${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;else if(key==="documentoTitular" && d.length===14)s=normalizeValue("cnpj",s);}
 if(["inicio","fim","dataAssinaturaMatriz","dataFormalizacao"].includes(key)){
  const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);if(m)s=`${m[3]}-${m[2]}-${m[1]}`;
  const words=/^(\d{1,2})(?:º)? de ([a-z]+) de (\d{4})$/.exec(norm(s));
  const months=["janeiro","fevereiro","marco","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  if(words && months.includes(words[2]))s=`${words[3]}-${String(months.indexOf(words[2])+1).padStart(2,"0")}-${words[1].padStart(2,"0")}`;
 }
 return s;
}
export function fieldsFromLines(lines:string[]) {
 const values:Record<string,string[]>={};
 const add=(key:string,raw:string)=>{const value=normalizeValue(key,raw);if(value && !labelLike(value) && !(values[key]||[]).includes(value.slice(0,500)))(values[key]||=[]).push(value.slice(0,500));};
 for(let i=0;i<lines.length;i++) {
  const clean=lines[i].replace(/^\s*\d+[.)]\s*/,"").replace(/^\s*(?:[•*“”"']+|[eé])\s*(?=(?:BANCO|AG[ÊE]NCIA|CONTA|TITULARIDADE|CNPJ\/CPF|RAZ[ÃA]O SOCIAL|NOME FANTASIA)\b)/i,''),n=norm(clean);
  // Identity printed in a document header: NAME (CNPJ), without form labels.
  const identity=i<20?/^([\p{L}\p{N}][\p{L}\p{N}\s&.,'’/\-–]{2,180}?)\s*\(\s*(?:CNPJ\s*:?\s*)?(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{14})\s*\)\s*$/iu.exec(clean):null;
  if(identity){add("razaoSocial",identity[1]);add("cnpj",identity[2]);continue;}
  // Bank screenshots commonly place both explicit labels on one line.
  const bank=/\bAg(?:[êe]ncia)?\.?\s*:?\s*(\d{1,6}(?:\s*-\s*[\dXx])?)\s*[-–—•«/]*\s*(?:Cc\.?|C\/C|Conta(?: corrente)?)\s*:?\s*(\d{1,15}(?:\s*-\s*[\dXx])?)/i.exec(clean);
  if(bank){add("agencia",bank[1].replace(/\s/g,""));add("conta",bank[2].replace(/\s/g,""));
   const holder=clean.slice(0,bank.index).trim();
   if(lines.some(l=>/^Aplicativo .+ Empresas$/i.test(l.trim()))&&/^[\p{L}][\p{L}\s.'-]{5,100}$/u.test(holder)&&holder.split(/\s+/).length>=2)add('titularConta',holder);
   const app=lines.map(l=>/^Aplicativo (Santander) Empresas$/i.exec(l.trim())).find(Boolean);if(app)add('banco','Banco '+app[1]);
   continue;}
  const period=/^In[íi]cio(?: da vig[êe]ncia)?\s*:\s*(\d{2}\/\d{2}\/\d{4})\s*\|?\s*(?:T[ée]rmino|Fim(?: da vig[êe]ncia)?)\s*:\s*(\d{2}\/\d{2}\/\d{4})/i.exec(clean);
  if(period){add('inicio',period[1]);add('fim',period[2]);continue;}
  // Only typed numeric labels accept a missing colon. Narrative headings and
  // historic/alternative rates must not become the requested contract values.
  const typed:Array<[string,RegExp]>=[
   ["cnpj",/^CNPJ\s*(?:n[º°o.]?\s*)?:?\s*((?:\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})|\d{14})(?=\s|$|;|[.,](?!\d))/i],
   ["cep",/^CEP\s*:?\s*(\d{2}\.?\d{3}-?\d{3})(?=\s|$|[;,])/i],
   ["alunos",/^(?:Alunado|Quantidade de alunos)\s*:?\s*(\d{1,6})(?=\s|$)/i],
   ["remuneracao",/^Remunera[çc][ãa]o Kedu\s*\(%\)\s*:?\s*(\d{1,3}(?:[.,]\d{1,2})?\s*%)(?=\s|$)/i],
   ["valor",/^Valor\s*\(R\$\)\s*:?\s*((?:R\$\s*)?(?:\d{1,3}(?:\.\d{3})*|\d+),\d{2})(?=\s|$)/i],
   ["parcelas",/^(?:N[º°o]\.? de parcelas|Quantidade de parcelas)\s*:?\s*(\d{1,4})(?=\s|$)/i],
  ];
  const explicit=typed.find(([,pattern])=>pattern.test(clean));
  if(explicit){add(explicit[0],explicit[1].exec(clean)![1]);continue;}
  const label=index.find(x=>n===x.name || n.startsWith(x.name+":") || n.startsWith(x.name+" :") || n.startsWith(x.name+" |"));
  if(!label)continue;
  const separator=clean.slice(label.name.length).search(/[:|]/),raw=separator>=0?clean.slice(label.name.length+separator+1).trim():"";
  const next=raw || (lines[i+1] && !/^[^:]{1,100}:\s*$/.test(lines[i+1].trim()) && !index.some(x=>norm(lines[i+1])===x.name || norm(lines[i+1]).startsWith(x.name+":"))?lines[i+1]:"");
  const value=normalizeValue(label.key,next||"");
  if(label.key==="parcelas" && value && !/^\d+$/.test(value))continue;
  if(value)add(label.key,value);
 }
 const text=lines.join('\n');
 // Party qualification paragraphs fill only fields that labelled lines did not provide.
 const qualified={...bankFields(text),...qualificationFields(text,cnpj=>ownIdentity('cnpj',cnpj))};
 for(const [key,found] of Object.entries(qualified))if(!values[key]?.length)values[key]=found;
 return mergeExtractedFields(values,structuredIdentityFields(text));
}
export function extractProcessingFile(bytes:Buffer,name:string) {
 if(!/\.docx$/i.test(name))return {text:"",fields:{},problem:"O anexo não contém texto DOCX disponível para análise. Envie uma cópia DOCX legível."};
 try {
  const lines=contractParagraphs(bytes),fields=fieldsFromLines(lines),W="http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const xml=new PizZip(bytes).file("word/document.xml")!.asText();
  const doc=new DOMParser({onError:()=>{throw Error("XML inválido.");}}).parseFromString(xml,"application/xml");
  const tables=Array.from(doc.getElementsByTagNameNS(W,'tbl'));
  if(tables.length){
   const tableTexts=new Set(tables.flatMap(table=>Array.from(table.getElementsByTagNameNS(W,'p')).map(p=>Array.from(p.getElementsByTagNameNS(W,'t')).map(t=>t.textContent||'').join('').trim())));
   for(const key of Object.keys(fields))delete fields[key];
   mergeExtractedFields(fields,fieldsFromLines(lines.filter(line=>!tableTexts.has(line.trim()))));
   for(const table of tables){
    const rows=Array.from(table.getElementsByTagNameNS(W,'tr')).map(row=>Array.from(row.childNodes).filter((node:any)=>node.localName==='tc').map((cell:any)=>Array.from(cell.getElementsByTagNameNS(W,'p')).map((p:any)=>Array.from(p.getElementsByTagNameNS(W,'t')).map((t:any)=>t.textContent||'').join('')).join('\n')));
    mergeExtractedFields(fields,fieldsFromRows(rows));
    for(const row of rows)for(const cell of row)mergeExtractedFields(fields,fieldsFromLines(cell.split('\n')));
   }
  }
  for(const control of Array.from(doc.getElementsByTagNameNS(W,"sdt"))) {
   const tag=control.getElementsByTagNameNS(W,"tag")[0]?.getAttributeNS(W,"val")||"";
   const rawKey=tag.replace(/^kedu:/,"");
   const key=["dataFormalizacaoExtenso","dataAssinaturaMatrizExtenso","inicioExtenso","fimExtenso"].includes(rawKey)?derivedFrom[rawKey]:rawKey;
   if(!editableKeys.includes(key))continue;
   const contents=control.getElementsByTagNameNS(W,"sdtContent")[0];if(!contents)continue;
   const value=normalizeValue(key,Array.from(contents.getElementsByTagNameNS(W,"t")).map(t=>t.textContent||"").join(""));
   if(value)(fields[key]||=[]).push(value);
  }
  const manifest=new PizZip(bytes).file("customXml/kedu-template.json")?.asText();
  if(manifest){const profile=JSON.parse(manifest).profile;const modes:Record<string,string>={"canva-contrato_garantia_completa":"Garantia Completa","canva-contrato_garantia_conjunta":"Garantia Conjunta","canva-contrato_garantia_prevista":"Garantia Prevista"};if(modes[profile])fields.modalidade=[modes[profile]];}
  return {text:lines.join("\n"),fields,problem:lines.length?"":"O documento está vazio ou contém apenas imagens."};
 }
 catch{return {text:"",fields:{},problem:"Não foi possível ler o DOCX com segurança. Confira o arquivo e envie uma cópia legível sem revisões ocultas."};}
}
