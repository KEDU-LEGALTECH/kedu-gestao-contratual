import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { extractProcessingFile,fieldsFromLines } from "./processing-extract.js";
import {interruptedReading} from './reading-policy.js';
import PizZip from 'pizzip';
import {readingFilename} from './reading-format.js';
export const readerVersion=2;
export const supportedReading=/\.(docx|doc|pdf|png|jpe?g|webp|tiff?|bmp|gif|txt|csv|odt|xlsx|pptx)$/i;
export type Reading={version:number;text:string;fields:Record<string,string[]>;problem:string;method:string;needsReview:boolean;incomplete?:boolean;confidence?:number;pages?:number;formulaCount?:number;warnings?:string[];verifiedFields?:string[];digitalFields?:Record<string,string[]>;tableFields?:Record<string,string[]>};
export function readingFailure(problem:string):Reading{return {version:readerVersion,text:"",fields:{},problem,method:"inconclusiva",needsReview:false};}
let queue:Promise<unknown>=Promise.resolve();
/** Parsers and OCR run in a bounded child process; no remote OCR service. */
export type ReadingRegion={page:number;x:number;y:number;width:number;height:number;rotation:number};
export function validReadingRegion(region:ReadingRegion) {
 return region && Number.isInteger(region.page)&&region.page>=1&&region.page<=30&&[0,90,180,270].includes(region.rotation)&&[region.x,region.y,region.width,region.height].every(Number.isFinite)&&region.x>=0&&region.y>=0&&region.width>=0.02&&region.height>=0.02&&region.x+region.width<=1.000001&&region.y+region.height<=1.000001;
}
export async function readProcessingFile(bytes:Buffer,name:string,region?:ReadingRegion):Promise<Reading> {
 if(!bytes.length)return readingFailure("O arquivo recebido está vazio. Obtenha uma cópia legível.");
 if(bytes.length>20*1024*1024)return readingFailure("O arquivo excede o limite de leitura de 20 MB. Separe o documento em partes para conferência.");
 const detected=readingFilename(bytes,name);if(detected!==name)name=name.replace(/\.[^./\\]+$/,'')+'.'+detected.split('.').pop();
 if(region && (!validReadingRegion(region)||!/\.(pdf|png|jpe?g|webp|tiff?|bmp|gif)$/i.test(name)))return readingFailure('Selecione uma região válida de um PDF ou imagem.');
 if(!supportedReading.test(name))return readingFailure("Formato sem leitor disponível. O original foi preservado; envie PDF, imagem, Word, ODT, XLSX, PPTX, TXT ou CSV para análise.");
 if(/\.docx$/i.test(name)){
  const extracted=extractProcessingFile(bytes,name);
  if(extracted.problem)return {...extracted,version:readerVersion,method:'DOCX',needsReview:false};
  const embedded=Object.keys(new PizZip(bytes).files).some(n=>/^word\/media\/.+\.(png|jpe?g|webp|bmp|tiff?)$/i.test(n));
  if(!embedded)return {...extracted,version:readerVersion,method:'DOCX',needsReview:false};
 }
 if(/\.(txt|csv)$/i.test(name)) {
  const text=(bytes[0]===255 && bytes[1]===254?bytes.subarray(2).toString("utf16le"):bytes.toString("utf8")).replace(/^\uFEFF/,"");
  if(text.length>500000 || /\x00|\uFFFD/.test(text))return readingFailure("Texto muito grande ou codificação não reconhecida. Salve como UTF-8.");
  return {version:readerVersion,text,fields:fieldsFromLines(text.split(/\r?\n/).map(x=>x.replace(/[;\t]/g,": "))),problem:text.trim()?"":"Nenhum texto legível foi encontrado.",method:"Texto",needsReview:false};
 }
 const task=()=>new Promise<Reading>(resolve=>{
  const child=fork(fileURLToPath(new URL("./file-reading-worker.ts",import.meta.url)),[],{execArgv:["--import","tsx","--max-old-space-size=512"],serialization:"advanced",stdio:["ignore","ignore","ignore","ipc"]});
  let done=false,partial:Reading|undefined;
  const finish=(result:Reading)=>{if(done)return;done=true;clearTimeout(timer);child.kill();resolve(result);};
  const timer=setTimeout(()=>finish(partial?.text?interruptedReading(partial,'Leitura parcial: o tempo limite foi atingido. As páginas restantes precisam ser conferidas; este resultado não permite aprovação automática.'):readingFailure("A leitura excedeu 180 segundos. Divida o arquivo ou confira manualmente.")),180000);
  child.on("message",(result:any)=>{if(result.partial){partial=result.partial;return;}finish(result.problem && partial?.text?interruptedReading(partial,'Leitura incompleta: '+result.problem):result);});
  child.on("error",()=>finish(readingFailure("O leitor local não pôde ser iniciado. Tente novamente.")));
  child.on("exit",()=>finish(partial?.text?interruptedReading(partial,'Leitura parcial: o leitor foi interrompido antes de concluir o arquivo.'):readingFailure("Não foi possível concluir a leitura deste arquivo. Confira se está íntegro e sem senha.")));
  child.send({bytes,name,region});
 });
 const result=queue.then(task,task);queue=result.catch(()=>{});return result;
}
