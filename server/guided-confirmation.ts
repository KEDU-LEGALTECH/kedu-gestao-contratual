import {attachmentRole} from './reading-policy.js';
import {plausibleFieldValue} from './field-plausibility.js';

// Line breaks and punctuation become "|" so a name must be delimited, not a prefix of a longer name.
const words=(s:string)=>s.normalize('NFD').replace(/\p{Diacritic}/gu,'').toUpperCase().replace(/\s+-\s*(?=(?:ME|EPP|EIRELI|LTDA)\b)/g,' ').replace(/[\r\n,;:()\[\]"“”–—]+|\s-\s/g,' | ').replace(/[^A-Z0-9|]+/g,' ').trim().split(/\s+/).filter(Boolean);
const legalSuffix=/^(LTDA|ME|EPP|EIRELI|SA|S|A|DE|DA|DO|DAS|DOS|E)$/;
const before=new Set(['|','CONTRATADA','CONTRATANTE','CONTRATADO','CEDENTE','CESSIONARIA','CESSIONARIO','LOCADORA','LOCADOR','LOCATARIA','LOCATARIO','OUTORGANTE','OUTORGADA','OUTORGADO','DENOMINADA','EMPRESA','EMPRESARIAL','SOCIAL','FANTASIA','NOME','TITULAR','FAVORECIDO','BENEFICIARIO','CLIENTE','RECEBEDOR','ASSOCIADO','ASSOCIADA','REPRESENTANTE','LEGAL','ADMINISTRADOR','ADMINISTRADORA','PROCURADOR','PROCURADORA','DIRETOR','DIRETORA','SR','SRA','POR','PELO','PELA','RAZAO','A','O']);
const after=new Set(['|','LTDA','ME','EPP','EIRELI','SA','CNPJ','CPF','RG','INSCRITA','INSCRITO','PESSOA','PORTADOR','PORTADORA','BRASILEIRO','BRASILEIRA','CASADO','CASADA','SOLTEIRO','SOLTEIRA','DIVORCIADO','DIVORCIADA','COM','SITUADA','ESTABELECIDA','SEDIADA','NESTE','DORAVANTE','NOME','NO','NA','AGENCIA','CONTA','BANCO']);
const nameFields=['razaoSocial','nomeFantasia','titularConta','representanteNome'],idFields=['cnpj','documentoTitular','representanteCpf'];
const bankFields=['titularConta','documentoTitular'];
const labelledFields=['agencia','conta','remuneracao','repasse','garantia','inicio','fim'];

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
 razaoSocial:/(?:^| )(?:RAZAO SOCIAL|NOME EMPRESARIAL|NOME DA EMPRESA|DENOMINACAO SOCIAL|DENOMINADA|SOCIEDADE(?: EMPRESARIA)?(?: LIMITADA)?(?: UNIPESSOAL)?|CONTRATADA|CONTRATANTE|CONTRATADO|CEDENTE|CESSIONARIA|CESSIONARIO|LOCADORA|LOCADOR|LOCATARIA|LOCATARIO|OUTORGANTE|INSTITUICAO DE ENSINO|DE UM LADO(?: A| O)?|DE OUTRO LADO(?: A| O)?)$/,
 // Cartão CNPJ prints the PORTE column on the same line as the label.
 nomeFantasia:/(?:^| )(?:NOME (?:DE )?FANTASIA(?: PORTE)?|SOB NOME FANTASIA|MANTENEDORA D[OA]|TITULO DO ESTABELECIMENTO|EXPRESSAO)$/,
 titularConta:/(?:^| )(?:TITULAR(?: DA CONTA)?|NOME DO TITULAR|TITULARIDADE|FAVORECIDO|BENEFICIARIO|CLIENTE|RECEBEDOR|ASSOCIADO|ASSOCIADA|RAZAO SOCIAL|NOME)$/,
 representanteNome:/(?:^| )(?:REPRESENTANTE(?: LEGAL)?|NOME DO REPRESENTANTE|ADMINISTRADOR(?:A)?|SOCIO(?:A)?(?: ADMINISTRADOR(?:A)?)?|PROCURADOR(?:A)?|DIRETOR(?:A)?|REPRESENTAD[OA] POR|NESTE ATO(?: REPRESENTAD[OA])? POR(?: SEU| SUA)?(?: REPRESENTANTE(?: LEGAL)?| ADMINISTRADOR(?:A)?| PROCURADOR(?:A)?| SOCIO(?:A)?)?(?: SR| SRA)?)$/,
};
// A legal entity qualification right after the name ("X LTDA, inscrita no CNPJ").
const legalQualification=/^(?:CNPJ|INSCRITA|PESSOA JURIDICA|SOCIEDADE(?:\s+(?:EMPRESARIA|SIMPLES|LIMITADA|EDUCACIONAL|CIVIL|INSCRITA|CUJO))?|MANTENEDORA|COM SEDE|SEDIADA|ESTABELECIDA)/;
const representativeQualification=/^(?:BRASILEIR[OA]|PORTADOR(?:A)?|INSCRIT[OA] NO CPF|CPF|RG|CASAD[OA]|SOLTEIR[OA]|DIVORCIAD[OA])/;
const fold=(s:string)=>s.normalize('NFD').replace(/\p{Diacritic}/gu,'').toUpperCase().replace(/\s+/g,' ');
const residential=/RESIDENTE|DOMICILIAD|PORTADOR|NASCID|CASAD|SOLTEIR|DIVORCIAD|VIUV|FALECEU/;
const companyAddress=/SEDE|SEDIAD|ESTABELECID|PESSOA JURIDICA|INSCRITA NO C|NOME EMPRESARIAL|RAZAO SOCIAL/;
const payerContext=/\b(?:PAGADOR|REMETENTE|CONTA DE ORIGEM)\b[\s\S]{0,80}$/;

function nameAssociated(key:string,text:string[],target:string[],at:number){
 const prefix=text.slice(Math.max(0,at-6),at).filter(w=>w!=='|').join(' ');
 if(nameLabels[key]?.test(prefix))return true;
 const suffix=text.slice(at+target.length,at+target.length+4).filter(w=>w!=='|').join(' ');
 if(key==='razaoSocial'&&legalQualification.test(suffix))return true;
 return key==='representanteNome'&&representativeQualification.test(suffix);
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

function labelledOccurrences(key:string,text:string,expected:string):boolean[]{
 const flat=fold(text);
 if(key==='agencia'||key==='conta'){
  const norm=(s:string)=>s.replace(/[\s.\-]/g,'').toUpperCase();
  const target=norm(expected);if(!target)return [];
  const label=key==='agencia'?/\bAG(?:ENCIA)?\.?\s*(?:N[º°O.]?\s*)?[:\-–]?\s*$/:/\b(?:CONTA(?:\s+CORRENTE)?|NUMERO DA CONTA|C\/C|CC\.?)\s*(?:N[º°O.]?\s*)?[:\-–]?\s*$/;
  return [...flat.matchAll(/\b\d{1,15}(?:\s*-\s*[\dX])?\b/g)]
   .filter(m=>norm(m[0])===target)
   .map(m=>{const pre=flat.slice(Math.max(0,m.index!-90),m.index!);return label.test(pre)&&!payerContext.test(pre);});
 }
 if(['remuneracao','repasse','garantia'].includes(key)){
  const m=/^(\d{1,3})(?:[.,](\d{1,2}))?\s*%?$/.exec(expected.trim());if(!m)return [];
  const target=`${Number(m[1])},${(m[2]||'').padEnd(2,'0')}`;
  const label=key==='remuneracao'?/\b(?:TAXA(?:\s+DE\s+REMUNERACAO)?(?:\s+KEDU)?|REMUNERACAO(?:\s+KEDU)?|PERCENTUAL\s+DE\s+REMUNERACAO)\b[^0-9%\n]{0,35}$/:
   key==='repasse'?/\b(?:PERCENTUAL\s+DE\s+REPASSE|REPASSE)\b[^0-9%\n]{0,35}$/:/\b(?:PERCENTUAL\s+DE\s+GARANTIA|GARANTIA(?:\s+DE\s+RECEITA)?)\b[^0-9%\n]{0,35}$/;
  return [...flat.matchAll(/\b(\d{1,3})(?:[.,](\d{1,2}))?\s*%/g)]
   .filter(x=>`${Number(x[1])},${(x[2]||'').padEnd(2,'0')}`===target)
   .map(x=>label.test(flat.slice(Math.max(0,x.index!-70),x.index!)));
 }
 if(key==='inicio'||key==='fim'){
  const iso=/^(\d{4})-(\d{2})-(\d{2})$/.exec(expected.trim())||(/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(expected.trim())?[expected,expected.slice(6,10),expected.slice(3,5),expected.slice(0,2)]:null);
  if(!iso)return [];
  const [,yyyy,mm,dd]=iso,br=`${dd}/${mm}/${yyyy}`;
  const months=['JANEIRO','FEVEREIRO','MARCO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];
  const month=months[Number(mm)-1];
  const label=key==='inicio'?/\b(?:INICIO(?:\s+DA\s+VIGENCIA)?|DATA\s+DE\s+INICIO|VIGENCIA\s+INICIAL|A\s+PARTIR\s+DE|VIGOR\s+A\s+PARTIR\s+DE)\b[^0-9\n]{0,35}$/:
   /\b(?:FIM(?:\s+DA\s+VIGENCIA)?|TERMINO(?:\s+DA\s+VIGENCIA)?|DATA\s+FINAL|VIGENCIA\s+FINAL|ATE\s+O\s+DIA|VALIDO\s+ATE)\b[^0-9\n]{0,35}$/;
  const pattern=new RegExp(`\\b(?:${br.replace(/\//g,'\\/')}|0?${Number(dd)}(?:º|O)?\\s+DE\\s+${month}\\s+DE\\s+${yyyy})\\b`,'g');
  return [...flat.matchAll(pattern)].map(x=>label.test(flat.slice(Math.max(0,x.index!-70),x.index!)));
 }
 return [];
}

/** Locates the exact GLPI value in an attachment already read when no field extractor captured it.
 * Only strong identifiers count: delimited names with two distinctive words, valid CNPJ/CPF, full CEP,
 * or explicitly labelled agency/account, percentage or vigencia dates.
 * Bank holder data must come from a bank document; reports, simulations and counterproposals never confirm.
 * `associated` means a field label or legal qualification is printed next to the value; otherwise
 * the occurrence only shows that the value exists somewhere in the document. */
export function guidedConfirmation(key:string,expected:string,files:{name:string;extracted:string;problem?:string|null}[]) {
 const target=searchTarget(key,expected);if(!target)return undefined;
 let located:{value:string;source:string;associated:boolean}|undefined;
 for(const file of files){
  const text=readableText(file);if(!text)continue;
  const role=attachmentRole(file.name,text);
  if(['report','counterproposal','simulation'].includes(role)||(bankFields.includes(key)&&role!=='bank')||(['agencia','conta'].includes(key)&&!['bank','document'].includes(role))||(['remuneracao','repasse','garantia','inicio','fim','representanteNome'].includes(key)&&role==='bank'))continue;
  const hits=occurrences(key,text,target,expected);
  if(hits.some(Boolean))return {value:expected,source:file.name,associated:true};
  if(hits.length&&!located&&!labelledFields.includes(key))located={value:expected,source:file.name,associated:false};
 }
 return located;
}
function searchTarget(key:string,expected:string){
 if(![...nameFields,...idFields,...labelledFields,'cep'].includes(key)||!expected)return undefined;
 if(labelledFields.includes(key))return plausibleFieldValue(key,expected)?[expected]:undefined;
 const target=words(expected);
 if(nameFields.includes(key)&&(target.includes('|')||target.filter(w=>w.length>2&&!legalSuffix.test(w)).length<2||target.join(' ').length<10))return undefined;
 const digits=expected.replace(/\D/g,'');
 if(idFields.includes(key)&&!plausibleFieldValue(key,expected)||key==='cep'&&digits.length!==8)return undefined;
 return target;
}
function readableText(file:{extracted:string;problem?:string|null}){
 if(file.problem)return '';
 try{const text=String(JSON.parse(file.extracted||'{}').text||'');return text.trim()?text:'';}catch{return '';}
}
function occurrences(key:string,text:string,target:string[],expected:string){
 if(labelledFields.includes(key))return labelledOccurrences(key,text,expected);
 // Also try the layout variants: a name wrapped across lines, and table columns separated by wide gaps.
 if(nameFields.includes(key))return [text,text.replace(/[ \t]{3,}/g,'\n'),text.replace(/(?<=\S)[ \t]*\r?\n[ \t]*(?=\S)/g,' ')].flatMap(variant=>{const tokens=words(variant);return delimitedName(tokens,target).map(at=>nameAssociated(key,tokens,target,at));});
 const flat=fold(text),digits=expected.replace(/\D/g,'');
 return [...flat.matchAll(/\d[\d.\-\/]{6,22}\d/g)].filter(m=>m[0].replace(/\D/g,'')===digits).map(m=>numberAssociated(key,flat,m.index!,m[0].length));
}
/** Which attachment prints the value, whatever its role. Helps a person find it and never confirms the field. */
export function attachmentWithValue(key:string,expected:string,files:{name:string;extracted:string;problem?:string|null}[]) {
 const target=searchTarget(key,expected);if(!target)return undefined;
 return files.find(file=>{const text=readableText(file);return !!text&&occurrences(key,text,target,expected).length>0;})?.name;
}
