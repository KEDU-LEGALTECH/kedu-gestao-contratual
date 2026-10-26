import {norm,normalizeValue} from './processing-extract.js';
type Word={text:string;confidence:number;bbox:{x0:number;y0:number;x1:number;y1:number}};
type Line={text:string;words:Word[];bbox:{x0:number;y0:number;x1:number;y1:number}};
export type LocatedField={key:string;value:string;confidence:number;excerpt:string};
const labels:[string,RegExp][]=[['razaoSocial',/^nome empresarial$/],['nomeFantasia',/^(?:titulo do estabelecimento )?\(?nome de fantasia\)?$/],['rua',/^logradouro$/],['numero',/^numero$/],['cep',/^cep$/],['bairro',/^bairro\/?distrito$/],['cidade',/^municipio$/],['estado',/^uf$/]];
export function registrationFieldsFromLines(lines:Line[]):LocatedField[]{
 const fields:LocatedField[]=[];
 for(let i=0;i<lines.length-1;i++){
  const line=lines[i],header=norm(line.text).replace(/\s+/g,' ').trim();
  const whole=labels.find(([,rx])=>rx.test(header));
  const anchors=whole?[{key:whole[0],x:line.bbox.x0}]:line.words.flatMap(word=>{const label=labels.find(([,rx])=>rx.test(norm(word.text)));return label?[{key:label[0],x:word.bbox.x0}]:[];});
  if(!anchors.length)continue;
  const next=lines[i+1];if(next.bbox.y0<line.bbox.y0||next.bbox.y0-line.bbox.y1>120)continue;
  for(let j=0;j<anchors.length;j++){
   const a=anchors[j],right=anchors[j+1]?.x??Infinity;
   const words=next.words.filter(w=>w.bbox.x0>=a.x-35&&w.bbox.x0<right-35&&/[\p{L}\d]/u.test(w.text));
   const raw=words.map(w=>w.text).join(' '),value=normalizeValue(a.key,raw);
   if(!value||labels.some(([,rx])=>rx.test(norm(value))))continue;
   if(a.key==='cep'&&!/^\d{5}-\d{3}$/.test(value))continue;
   if(a.key==='estado'&&!/^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/.test(value))continue;
   if(a.key==='numero'&&!/^\d+[a-zA-Z]?$/.test(value))continue;
   fields.push({key:a.key,value,confidence:Math.min(...words.map(w=>w.confidence)),excerpt:line.text.trim()+'\n'+next.text.trim()});
  }
 }
 return fields;
}
export function validCnpj(value:string){
 const digits=value.replace(/\D/g,'');if(!/^\d{14}$/.test(digits)||/^(.)\1+$/.test(digits))return false;
 for(const size of [12,13]){let sum=0,weight=size-7;for(let i=0;i<size;i++){sum+=Number(digits[i])*weight;if(--weight<2)weight=9;}const digit=sum%11<2?0:11-sum%11;if(digit!==Number(digits[size]))return false;}return true;
}
