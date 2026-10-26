import {inputLabels,norm} from './processing-extract.js';
export function fieldExcerpt(text:string,values:string[]) {
 const lines=text.split(/\r?\n/),compact=(s:string)=>norm(s).replace(/[^a-z0-9]/g,'');
 const index=lines.findIndex(line=>values.some(value=>compact(value).length>=3&&compact(line).includes(compact(value))));
 return index<0?'':lines.slice(Math.max(0,index-1),index+2).join('\n').slice(0,700);
}
export function readingGuidance(reading:{fields?:Record<string,string[]>;confidence?:number;formulaCount?:number;incomplete?:boolean;problem?:string},role:string) {
 if(reading.problem)return reading.problem;
 if(reading.incomplete)return 'Leitura parcial: ainda há trechos ou páginas não conferidos.';
 if(role==='counterproposal')return 'Contraproposta: as condições sugeridas ainda precisam de decisão.';
 const ambiguous=Object.entries(reading.fields||{}).filter(([,values])=>new Set(values.map(norm)).size>1).map(([key])=>inputLabels[key]||key);
 if(ambiguous.length)return 'Mais de um valor encontrado: '+ambiguous.join(', ')+'. Confira qual pertence ao documento e à parte correta.';
 if(reading.formulaCount)return `Planilha com ${reading.formulaCount} fórmulas. Os resultados calculados não foram adotados; confira os campos e os cálculos no original.`;
 if(!Object.keys(reading.fields||{}).length)return 'Nenhum campo reconhecido. Selecione o trecho relevante para uma nova leitura ou envie uma cópia mais nítida.';
 if(typeof reading.confidence==='number'&&reading.confidence<85)return 'Há trechos com baixa confiança de OCR. Confira os campos abaixo ou delimite a região para reler.';
 return 'Os campos ainda não têm confirmação suficiente. Confira somente os valores pendentes com o original.';
}
const values=(text:string)=>({percentuais:[...new Set(text.match(/\b\d{1,3}(?:[.,]\d{1,2})?\s*%/g)||[])],valores:[...new Set(text.match(/R\$\s*\d[\d.,]*/g)||[])],datas:[...new Set(text.match(/\b\d{2}\/\d{2}\/\d{4}\b/g)||[])]});
/** These are descriptions of proposed changes, never approved financial inputs. */
export function proposedChanges(text:string) {
 return [...text.matchAll(/Minuta:\s*([\s\S]*?)Reda[çc][ãa]o proposta:\s*([\s\S]*?)(?=Fundamento:|\n\s*\d+\.\d+\.\s|$)/gi)].slice(0,30).map((m,index)=>({id:index,original:m[1].trim().slice(0,1800),proposed:m[2].trim().slice(0,2400),originalValues:values(m[1]),proposedValues:values(m[2]),approval:'Proposta — aprovação não informada'}));
}
