import { contractParagraphs } from "./attachment-analysis.js";
import { fieldLabels,officialInputs,derivedFrom } from "../shared/official-fields.js";
import PizZip from "pizzip";
import { DOMParser } from "@xmldom/xmldom";
export const inputLabels:Record<string,string>={...fieldLabels,...officialInputs,endereco:"Endereço",modalidade:"Modalidade de garantia",matriz:"Contrato matriz",motivo:"Descrição da solicitação"};
export const editableKeys=Object.keys(inputLabels).filter(k=>k!=="aditivo");
export const norm=(s:string)=>s.normalize("NFD").replace(/\p{Diacritic}/gu,"").toLowerCase().replace(/\s+/g," ").trim();
const aliases:Record<string,string[]>={
 cnpj:["CNPJ","CNPJ da contratante"],razaoSocial:["RAZÃO SOCIAL","Razão social da contratante"],nomeFantasia:["NOME FANTASIA"],
 remuneracao:["TAXA","TAXA KEDU","Taxa de remuneração","REMUNERAÇÃO"],garantia:["PERCENTUAL DE GARANTIA"],repasse:["PERCENTUAL DE REPASSE"],valor:["VALOR DE REFERÊNCIA","VALOR CONTRATUAL"],
 endereco:["ENDEREÇO","ENDEREÇO COMPLETO"],rua:["RUA","LOGRADOURO","RUA / LOGRADOURO"],estado:["ESTADO","UF"],
 inicio:["INÍCIO DA VIGÊNCIA","DATA DE INÍCIO","INÍCIO"],fim:["FIM DA VIGÊNCIA","DATA FINAL","TÉRMINO DA VIGÊNCIA"],
 dataFormalizacao:["DATA DE FORMALIZAÇÃO"],dataAssinaturaMatriz:["DATA DE ASSINATURA DA MATRIZ","DATA DE ASSINATURA DO CONTRATO MATRIZ"],
 representanteNome:["REPRESENTANTE LEGAL","NOME DO REPRESENTANTE"],representanteCpf:["CPF DO REPRESENTANTE"],
 titularConta:["TITULAR DA CONTA"],documentoTitular:["CPF/CNPJ DO TITULAR"],modalidade:["MODALIDADE","MODALIDADE DE GARANTIA"],
};
for(const k of editableKeys)aliases[k]=[...(aliases[k]||[]),inputLabels[k]];
const index=Object.entries(aliases).flatMap(([key,names])=>names.map(name=>({key,name:norm(name)}))).sort((a,b)=>b.name.length-a.name.length);
export function normalizeValue(key:string,value:string) {
 let s=value.trim().replace(/^[:\s]+/,"");
 if(/\{[^}]+\}|\[(?:DADO|NOME|PREENCHER)|PENDENTE|⟨/i.test(s))return "";
 if(["remuneracao","garantia","repasse","repasseSegundo","cashback"].includes(key)) {const m=/^(\d{1,3})(?:[.,](\d{1,2}))?\s*%$/.exec(s);if(m)s=Number(m[1])+","+(m[2]||"").padEnd(2,"0")+"%";}
 if(key==="modalidade"){const known=["Garantia Completa","Garantia Conjunta","Garantia Prevista"].find(x=>norm(x)===norm(s));if(known)s=known;}
 if(key==="cnpj"){const d=s.replace(/\D/g,"");if(d.length===14)s=`${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;}
 if(key==="cep" && /^\d{2}\.?\d{3}-?\d{3}$/.test(s)){const d=s.replace(/\D/g,"");s=d.slice(0,5)+"-"+d.slice(5);}
 if(["valor","cashbackValor"].includes(key) && /^(?:R\$\s*)?(?:\d{1,3}(?:\.\d{3})*|\d+),\d{2}$/.test(s))s=s.replace(/R\$|\s|\./g,"");
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
 for(let i=0;i<lines.length;i++) {
  const clean=lines[i].replace(/^\s*\d+[.)]\s*/,""),n=norm(clean);
  const label=index.find(x=>n===x.name || n.startsWith(x.name+":") || n.startsWith(x.name+" :"));
  if(!label)continue;
  const colon=clean.indexOf(":",label.name.length),raw=colon>=0?clean.slice(colon+1).trim():"";
  const next=raw || (lines[i+1] && !/^[^:]{1,100}:\s*$/.test(lines[i+1].trim()) && !index.some(x=>norm(lines[i+1])===x.name || norm(lines[i+1]).startsWith(x.name+":"))?lines[i+1]:"");
  const value=normalizeValue(label.key,next||"");
  if(value)(values[label.key]||=[]).push(value.slice(0,500));
 }
 return values;
}
export function extractProcessingFile(bytes:Buffer,name:string) {
 if(!/\.docx$/i.test(name))return {text:"",fields:{},problem:"O anexo não contém texto DOCX disponível para análise. Envie uma cópia DOCX legível."};
 try {
  const lines=contractParagraphs(bytes),fields=fieldsFromLines(lines),W="http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const xml=new PizZip(bytes).file("word/document.xml")!.asText();
  const doc=new DOMParser({onError:()=>{throw Error("XML inválido.");}}).parseFromString(xml,"application/xml");
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
