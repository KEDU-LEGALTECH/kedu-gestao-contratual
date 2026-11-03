import {validCnpj} from './registration-reading.js';
import {validCpf} from './reading-validation.js';
type Fields=Record<string,string[]>;
const states:Record<string,string>={acre:'AC',alagoas:'AL',amapa:'AP',amazonas:'AM',bahia:'BA',ceara:'CE','distrito federal':'DF','espirito santo':'ES',goias:'GO',maranhao:'MA','mato grosso':'MT','mato grosso do sul':'MS','minas gerais':'MG',para:'PA',paraiba:'PB',parana:'PR',pernambuco:'PE',piaui:'PI','rio de janeiro':'RJ','rio grande do norte':'RN','rio grande do sul':'RS',rondonia:'RO',roraima:'RR','santa catarina':'SC','sao paulo':'SP',sergipe:'SE',tocantins:'TO'};
const ufs=new Set(Object.values(states));
const plain=(s:string)=>s.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().trim();
const digits=(s:string)=>s.replace(/\D/g,'');
const cnpjMask=(d:string)=>`${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
const cpfMask=(d:string)=>`${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;
// Words that begin a party declaration; the company name follows the last one before "inscrita no CNPJ".
const partyStart=/(?:[;:]|\b(?:contratante|contratad[ao]|locador[a]?|locat[áa]ri[ao]|outorgante|outorgad[ao]|cedente|cession[áa]ri[ao]|partes|de um lado|de outro lado|síntese do contrato)\b)/giu;
const notName=/^(?:e|de|da|do|com|sede|endere[çc]o|nome fantasia|neste ato|pessoa jur[íi]dica|sociedade|contrato|instrumento|termo|aditivo|realiza[çc][ãa]o|procura[çc][ãa]o)\b/i;

/**
 * Party qualification paragraphs ("NOME, sociedade, inscrita no CNPJ sob o nº X, com sede na ...").
 * Only paragraphs anchored by a valid CNPJ are read; the portal's own company is skipped by the caller's filter.
 */
export function qualificationFields(source:string,isOwn:(cnpj:string)=>boolean=()=>false):Fields {
 const text=source.replace(/(\d)\s*[—–]\s*(\d)/g,'$1-$2').replace(/[ \t]*\n[ \t]*/g,' ').replace(/[ \t]{2,}/g,' ');
 const result:Fields={};
 const add=(key:string,value:string|undefined)=>{const v=value?.replace(/\s+/g,' ').replace(/^[\s,.;:-]+|[\s,;:-]+$/g,'').trim();if(v&&!(result[key]||=[]).includes(v))result[key].push(v);};
 const anchors=[...text.matchAll(/inscrit[ao]\s+no\s+(?:Cadastro Nacional[^,;]{0,40}?)?CNPJ\s*(?:\/\s*(?:ME|MF))?\s*(?:sob\s*(?:o\s*)?)?(?:n[º°o.]*)?\s*[:\s]*(\d{2}\.?\d{3}\.?\d{3}\s*\/?\s*\d{4}\s*-?\s*\d{2})(?!\d)/giu)];
 for(const [index,anchor] of anchors.entries()){
  const cnpj=digits(anchor[1]);if(!validCnpj(cnpj)||isOwn(cnpj))continue;
  const start=anchor.index!,end=start+anchor[0].length;
  // Preceding text back to the previous party declaration or anchor.
  const floor=index?anchors[index-1].index!+anchors[index-1][0].length:Math.max(0,start-400);
  const before=text.slice(Math.max(floor,start-400),start);
  const starts=[...before.matchAll(partyStart)];
  const lead=starts.length?before.slice(starts.at(-1)!.index!+starts.at(-1)![0].length):before;
  const after=text.slice(end,Math.min(anchors[index+1]?.index??text.length,end+600));
  const block=lead+' '+after;
  add('cnpj',cnpjMask(cnpj));
  const fantasy=/(?:cujo\s+)?nome\s+(?:de\s+)?fantasia\s*(?:é|e|:)?\s*([^,;]{2,100}?)\s*(?:,|;|$)/i.exec(lead);
  if(fantasy)add('nomeFantasia',fantasy[1]);
  // PDF reading order can join the instrument title to the first party's name.
  // Strip only an explicit known title terminator, still anchored to this CNPJ.
  const namedLead=lead.replace(/^[\s\S]*\b(?:OUTORGA DE DIREITOS|IDENTIFICA[ÇC][ÃA]O DAS PARTES CONTRATANTES)\s+/i,'');
  const name=namedLead.trim().replace(/^[,.\s]+/,'').split(/\s*,|\s+(?:pessoa jur[íi]dica|sociedade|com sede|com endere[çc]o|inscrit[ao])\b/i)[0].trim();
  if(name.length>=3&&name.length<=150&&/\p{Lu}/u.test(name[0])&&!notName.test(name)&&name.split(/\s+/).length>=2)add('razaoSocial',name);
  // Address: "com sede na/em/à ..." or "com endereço em ..." on either side of the CNPJ.
  const address=/com\s+(?:sede|endere[çc]o)\s+(?:na|no|em|à|a)\s+(.{5,260}?)(?=,?\s*(?:neste ato|inscrit[ao]|doravante|telefone|e-mail|representad[ao])|$)/i.exec(block)?.[1];
  if(address){
   const parts=address.split(/\s*,\s*/);
   const numero=/\bn[º°o]\.?\s*(\d{1,6}[A-Za-z]?|S\/N)\b/i.exec(address)?.[1]||(/^\d{1,6}[A-Za-z]?$/.test(parts[1]||'')?parts[1]:undefined);
   const street=parts[0].replace(/\s+\d{1,6}[A-Za-z]?$/,'').trim();
   if(/^(?:rua|r\.|av\.?|avenida|travessa|rodovia|estrada|alameda|pra[çc]a|quadra|largo)\b/i.test(street)&&street.length<=120)add('rua',street);
   if(numero)add('numero',numero.toUpperCase());
   const cep=/\bCEP\s*:?\s*(\d{2}\.?\d{3}-?\d{3})\b/i.exec(address)?.[1]||/\b(\d{2}\.\d{3}-\d{3})\b/.exec(address)?.[1];
   if(cep){const d=digits(cep);add('cep',d.slice(0,5)+'-'+d.slice(5));}
   const bairro=/\bbairro\s+(?!:)([^,;]{3,60})/i.exec(address)?.[1];
   if(bairro)add('bairro',bairro);
   const named=/na cidade de\s+([^,;]{3,60}?)\s*,\s*Estado d[eo]\s+([^,;]{2,30})/i.exec(address);
   const slash=/(?:^|,|\s-\s)\s*([\p{L}][\p{L} ']{2,40}?)\s*(?:\/|\s-\s)\s*([A-Z]{2})\b/u.exec(address);
   if(named){add('cidade',named[1]);const uf=states[plain(named[2])]||(ufs.has(named[2].trim().toUpperCase())?named[2].trim().toUpperCase():'');if(uf)add('estado',uf);}
   else if(slash&&ufs.has(slash[2])&&!/\b(?:rua|avenida|av|bairro|sala)\b/i.test(slash[1])){add('cidade',slash[1]);add('estado',slash[2]);}
  }
  // Representative named in the same paragraph, with an explicit and valid CPF.
  const rep=/representad[oa]\s*(?:\(a\))?[^,;]{0,30}?\b(?:por|pel[oa])\s+(?:seus?|suas?)?\s*(?:s[óo]ci[oa][\s-]*(?:administrador[ao]?)?|administrador[ao]?|representante\s+legal|diretor[ao]?|procurador[ao]?|titular)?\s*,?\s*(?:Sr[a]?\.?\s+)?([\p{Lu}][\p{L}'’.-]+(?:\s+[\p{L}'’.-]+){1,8}?)\s*(?=,)/u.exec(after);
  if(rep&&!/\b(?:atos|constitutivos|legal|representante|procurador)\b/i.test(rep[1])){
   const tail=after.slice(rep.index+rep[0].length,rep.index+rep[0].length+260);
   const cpf=/\bCPF\b[^\d]{0,30}(\d{3}\.?\d{3}\.?\d{3}\s*-?\s*\d{2})(?!\d)/i.exec(tail)?.[1];
   if(cpf&&validCpf(digits(cpf))){add('representanteNome',rep[1]);add('representanteCpf',cpfMask(digits(cpf)));}
  }
 }
 // A heading word glued to a name ("Elo COLEGIO X LTDA") repeats a shorter name already found.
 if(result.razaoSocial)result.razaoSocial=result.razaoSocial.filter(v=>!result.razaoSocial.some(o=>o!==v&&v.endsWith(' '+o)));
 if(result.rua)result.rua=result.rua.map(v=>v.replace(/\s+S\/N$/i,''));
 if(['rua','numero','bairro'].every(k=>result[k]?.length===1))add('endereco',`${result.rua[0]}, ${result.numero[0]}, ${result.bairro[0]}`);
 return result;
}
