import {attachmentRole} from './reading-policy.js';
import {plausibleFieldValue} from './field-plausibility.js';

// Line breaks and punctuation become "|" so a name must be delimited, not a prefix of a longer name.
const words=(s:string)=>s.normalize('NFD').replace(/\p{Diacritic}/gu,'').toUpperCase().replace(/\s+-\s*(?=(?:ME|EPP|EIRELI|LTDA)\b)/g,' ').replace(/[\r\n,;:()\[\]"“”–—]+|\s-\s/g,' | ').replace(/[^A-Z0-9|]+/g,' ').trim().split(/\s+/).filter(Boolean);
const legalSuffix=/^(LTDA|ME|EPP|EIRELI|SA|S|A|DE|DA|DO|DAS|DOS|E)$/;
const before=new Set(['|','CONTRATADA','CONTRATANTE','DENOMINADA','EMPRESA','EMPRESARIAL','SOCIAL','FANTASIA','NOME','TITULAR','FAVORECIDO','BENEFICIARIO','RAZAO','A','O']);
const after=new Set(['|','LTDA','ME','EPP','EIRELI','SA','CNPJ','CPF','INSCRITA','INSCRITO','PESSOA','COM','SITUADA','ESTABELECIDA','SEDIADA','NESTE','DORAVANTE','NOME','NO','NA','AGENCIA','CONTA','BANCO']);
const nameFields=['razaoSocial','nomeFantasia','titularConta'],idFields=['cnpj','documentoTitular','representanteCpf'];
const bankFields=['titularConta','documentoTitular'];

function delimitedName(text:string[],target:string[]) {
 const found:number[]=[];
 for(let i=0;i+target.length<=text.length;i++){
  if(target.some((w,j)=>text[i+j]!==w))continue;
  if((i===0||before.has(text[i-1]))&&(i+target.length===text.length||after.has(text[i+target.length])))found.push(i);
 }
 return found;
}

// Labels that tie an occurrence to the requested field. A name preceded by
// "nome fantasia" never proves a razão social and vice versa.
const nameLabels:Record<string,RegExp>={
 razaoSocial:/(?:^| )(?:RAZAO SOCIAL|NOME EMPRESARIAL|NOME DA EMPRESA|DENOMINACAO SOCIAL|DENOMINADA|SOCIEDADE(?: EMPRESARIA)?(?: LIMITADA)?(?: UNIPESSOAL)?|CONTRATADA|CONTRATANTE|LOCADORA|LOCATARIA)$/,
 // Cartão CNPJ prints the PORTE column on the same line as the label.
 nomeFantasia:/(?:^| )(?:NOME (?:DE )?FANTASIA(?: PORTE)?|TITULO DO ESTABELECIMENTO|EXPRESSAO)$/,
 titularConta:/(?:^| )(?:TITULAR(?: DA CONTA)?|FAVORECIDO|BENEFICIARIO|RAZAO SOCIAL|NOME)$/,
};
// A legal entity qualification right after the name ("X LTDA, inscrita no CNPJ").
const legalQualification=/^(?:CNPJ|INSCRITA|PESSOA JURIDICA)/;
const fold=(s:string)=>s.normalize('NFD').replace(/\p{Diacritic}/gu,'').toUpperCase().replace(/\s+/g,' ');
const residential=/RESIDENTE|DOMICILIAD|PORTADOR|NASCID|CASAD|SOLTEIR|DIVORCIAD|VIUV|FALECEU/;
const companyAddress=/SEDE|SEDIAD|ESTABELECID|PESSOA JURIDICA|INSCRITA NO C|NOME EMPRESARIAL|RAZAO SOCIAL/;

function nameAssociated(key:string,text:string[],target:string[],at:number){
 const prefix=text.slice(Math.max(0,at-6),at).filter(w=>w!=='|').join(' ');
 if(nameLabels[key]?.test(prefix))return true;
 return key==='razaoSocial'&&legalQualification.test(text.slice(at+target.length,at+target.length+4).filter(w=>w!=='|').join(' '));
}

/** Label or company context printed next to the number in the original. */
function numberAssociated(key:string,text:string,index:number,length:number){
 const prefix=text.slice(Math.max(0,index-40),index);
 if(key==='cnpj')return /CNPJ[^0-9]{0,30}$/.test(prefix);
 if(key==='representanteCpf')return /CPF[^0-9]{0,30}$/.test(prefix);
 if(key==='documentoTitular')return /(?:CNPJ|CPF)[^0-9]{0,30}$/.test(prefix);
 // The same CEP can belong to a partner's home; only a company address proves the field.
 if(!/CEP[^0-9]{0,4}$/.test(prefix))return false;
 const window=text.slice(Math.max(0,index-220),index),marker=Math.max(...[...window.matchAll(new RegExp(companyAddress.source,'g'))].map(m=>m.index!),-1);
 const home=Math.max(...[...window.matchAll(new RegExp(residential.source,'g'))].map(m=>m.index!),-1);
 if(marker>home)return true;
 return home<0&&/^.{0,60}INSCRITA NO C/.test(text.slice(index+length));
}

/** Locates the exact GLPI value in an attachment already read when no field extractor captured it.
 * Only strong identifiers count: delimited names with two distinctive words, valid CNPJ/CPF or full CEP.
 * Bank holder data must come from a bank document; reports, simulations and counterproposals never confirm.
 * `associated` means a field label or legal qualification is printed next to the value; otherwise
 * the occurrence only shows that the value exists somewhere in the document. */
export function guidedConfirmation(key:string,expected:string,files:{name:string;extracted:string;problem?:string|null}[]) {
 if(![...nameFields,...idFields,'cep'].includes(key)||!expected)return undefined;
 const target=words(expected);
 if(nameFields.includes(key)&&(target.includes('|')||target.filter(w=>w.length>2&&!legalSuffix.test(w)).length<2||target.join(' ').length<10))return undefined;
 const digits=expected.replace(/\D/g,'');
 if(idFields.includes(key)&&!plausibleFieldValue(key,expected)||key==='cep'&&digits.length!==8)return undefined;
 let located:{value:string;source:string;associated:boolean}|undefined;
 for(const file of files){
  if(file.problem)continue;
  let reading:any;try{reading=JSON.parse(file.extracted||'{}');}catch{continue;}
  const text=String(reading.text||'');if(!text.trim())continue;
  const role=attachmentRole(file.name,text);
  if(['report','counterproposal','simulation'].includes(role)||(bankFields.includes(key)&&role!=='bank'))continue;
  let hits:boolean[];
  // Also try the layout variants: a name wrapped across lines, and table columns separated by wide gaps.
  if(nameFields.includes(key))hits=[text,text.replace(/[ \t]{3,}/g,'\n'),text.replace(/(?<=\S)[ \t]*\r?\n[ \t]*(?=\S)/g,' ')].flatMap(variant=>{const tokens=words(variant);return delimitedName(tokens,target).map(at=>nameAssociated(key,tokens,target,at));});
  else{const flat=fold(text);hits=[...flat.matchAll(/\d[\d.\-\/]{6,22}\d/g)].filter(m=>m[0].replace(/\D/g,'')===digits).map(m=>numberAssociated(key,flat,m.index!,m[0].length));}
  if(hits.some(Boolean))return {value:expected,source:file.name,associated:true};
  if(hits.length&&!located)located={value:expected,source:file.name,associated:false};
 }
 return located;
}
