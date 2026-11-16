import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fieldsFromLines,mergeExtractedFields,norm,normalizeValue} from './processing-extract.js';
import {registrationFieldsFromLines,validCnpj} from './registration-reading.js';
import {sameRequestedValue} from './request-expectations.js';
export type OcrBox={text:string;confidence:number;box:number[]};
export type PaddleResult={passes:OcrBox[][];operations:string[];engine:string};
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
let child:ChildProcessWithoutNullStreams|undefined,buffer='',pending:{resolve:(result:PaddleResult|null)=>void;timer:ReturnType<typeof setTimeout>}|undefined;
let unavailable=false;
export const paddleRuntimePath=()=>process.env.KEDU_OCR_RUNTIME||join(root,'data/ocr-runtime.json');
/** A hosted API (KEDU_ROLE=api) reads only with PaddleOCR; elsewhere the reader may fall back to Tesseract as before. */
export function readerAvailable(){return process.env.KEDU_ROLE!=='api'||paddleConfigured();}
export function paddleConfigured(){return process.env.OCR_ENGINE!=='legacy'&&((process.env.NODE_ENV!=='test'&&!process.env.NODE_TEST_CONTEXT)||process.env.OCR_ENGINE==='paddle')&&existsSync(paddleRuntimePath());}
function stop(){child?.kill();child=undefined;buffer='';if(pending){clearTimeout(pending.timer);pending.resolve(null);pending=undefined;}}
export function closePaddle(){stop();}
/** Each file gets a fresh attempt after an earlier engine failure; a running engine is kept between files. */
export function resetPaddle(){if(!child)unavailable=false;}
export async function recognizeWithPaddle(png:Buffer,timeoutMs=90000):Promise<PaddleResult|null>{
 if(!paddleConfigured()||unavailable)return null;
 if(!child){
  try{
   const config=JSON.parse(readFileSync(paddleRuntimePath(),'utf8'));
   if(config.ready!==true||!existsSync(config.python))return null;
   child=spawn(config.python,['-u',join(root,'server/ocr/worker.py')],{cwd:root,windowsHide:true,env:{...process.env,HF_HUB_OFFLINE:'1',PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK:'True'},stdio:['pipe','pipe','pipe']});
   child.stderr.resume();
   child.stdout.setEncoding('utf8');
   child.stdout.on('data',chunk=>{
    buffer+=chunk.toString('utf8');if(buffer.length>8000000){unavailable=true;stop();return;}
    const newline=buffer.indexOf('\n');if(newline<0)return;
    const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);
    if(!pending)return;
    let result:PaddleResult|null=null;try{const parsed=JSON.parse(line);if(Array.isArray(parsed.passes)&&parsed.passes.length===2&&parsed.passes.every((p:any)=>Array.isArray(p)&&p.length<20000&&p.every((b:any)=>typeof b.text==='string'&&b.text.length<10000&&Number.isFinite(b.confidence)&&b.confidence>=0&&b.confidence<=100&&Array.isArray(b.box)&&b.box.length===4&&b.box.every(Number.isFinite))))result=parsed;}catch{}
    const task=pending;pending=undefined;clearTimeout(task.timer);task.resolve(result);
   });
   child.on('error',()=>{unavailable=true;stop();});child.on('exit',()=>{unavailable=true;stop();});
  }catch{unavailable=true;return null;}
 }
 if(pending)return null;
 return new Promise(resolveResult=>{
  const timer=setTimeout(()=>{unavailable=true;stop();},Math.max(1000,Math.min(90000,timeoutMs)));
  pending={resolve:resolveResult,timer};child!.stdin.write(JSON.stringify({image:png.toString('base64')})+'\n',error=>{if(error){unavailable=true;stop();}});
 });
}
export function paddleFields(boxes:OcrBox[]){
 const sorted=boxes.filter(b=>b.confidence>=80&&b.box.length===4).sort((a,b)=>a.box[1]-b.box[1]||a.box[0]-b.box[0]);
 const rows:OcrBox[][]=[];
 for(const box of sorted){
  const center=(box.box[1]+box.box[3])/2;
  const row=rows.find(r=>Math.abs((r[0].box[1]+r[0].box[3])/2-center)<Math.max(4,Math.min(r[0].box[3]-r[0].box[1],box.box[3]-box.box[1])*.6));
  if(row)row.push(box);else rows.push([box]);
 }
 const lines=rows.map(row=>{row.sort((a,b)=>a.box[0]-b.box[0]);return {text:row.map(b=>b.text).join(' '),words:row.map(b=>({text:b.text,confidence:b.confidence,bbox:{x0:b.box[0],y0:b.box[1],x1:b.box[2],y1:b.box[3]}})),bbox:{x0:row[0].box[0],y0:Math.min(...row.map(b=>b.box[1])),x1:Math.max(...row.map(b=>b.box[2])),y1:Math.max(...row.map(b=>b.box[3]))}};});
 const cadastral=/cadastro nacional|nome empresarial|nome de fantasia/i.test(sorted.map(b=>b.text).join('\n'));
 const fields=cadastral?{} as Record<string,string[]>:fieldsFromLines(lines.map(l=>l.text));
 const keyFor=(text:string)=>{
  const value=norm(text).replace(/[:.]+$/,'').trim();
  return /^nome empresarial$/.test(value)?'razaoSocial':/nome de fantasia/.test(value)?'nomeFantasia':value==='logradouro'?'rua':value==='numero'?'numero':value==='cep'?'cep':/^bairro\/?distrito$/.test(value)?'bairro':value==='municipio'?'cidade':value==='uf'?'estado':null;
 };
 // Paddle returns complete text boxes, not individual words. Match each label
 // to its nearest aligned value instead of joining neighbouring form columns.
 for(const label of sorted){
  const key=keyFor(label.text);if(!key)continue;
  const height=Math.max(8,label.box[3]-label.box[1]),center=(label.box[1]+label.box[3])/2;
  const values=sorted.filter(b=>b!==label&&!keyFor(b.text)&&Math.abs(b.box[0]-label.box[0])<Math.max(25,height*2)&&((b.box[1]+b.box[3])/2-center)>height*.3&&((b.box[1]+b.box[3])/2-center)<height*4).sort((a,b)=>(a.box[1]-label.box[1])+Math.abs(a.box[0]-label.box[0])-(b.box[1]-label.box[1])-Math.abs(b.box[0]-label.box[0]));
  const value=values[0]?.text;if(!value)continue;
  if(key==='cep'&&!/^\d{2}\.?\d{3}-?\d{3}$/.test(value))continue;
  if(key==='estado'&&!/^[A-Z]{2}$/.test(value))continue;
  if(key==='numero'&&!/^\d+[A-Za-z]?$/.test(value))continue;
  mergeExtractedFields(fields,{[key]:[normalizeValue(key,value)]});
 }
 // Only cadastral/explicit identity labels permit an otherwise unlabelled CNPJ.
 if(/cadastro nacional|cnpj|inscri[çc][ãa]o/i.test(lines.map(l=>l.text).join('\n')))for(const box of sorted)if(validCnpj(box.text))mergeExtractedFields(fields,{cnpj:[normalizeValue('cnpj',box.text)]});
 if(fields.cnpj)fields.cnpj=fields.cnpj.filter(validCnpj);
 if(fields.cnpj&&!fields.cnpj.length)delete fields.cnpj;
 if(['rua','numero','bairro'].every(k=>fields[k]?.length===1))fields.endereco=[fields.rua[0]+', '+fields.numero[0]+', '+fields.bairro[0]];
 return {fields,text:lines.map(l=>l.text).join('\n')};
}
export function combineOcrFields(existing:Record<string,string[]>,verified:string[],paddle:PaddleResult){
 const first=paddleFields(paddle.passes[0]),second=paddleFields(paddle.passes[1]);
 const fields:Record<string,string[]>=structuredClone(existing),verifiedFields=new Set(verified);
 const consensus=new Set<string>();
 for(const [key,values]of Object.entries(second.fields)){
  // New fields need agreement between both image versions; disagreements are never silently replaced.
  if(values.length!==1||first.fields[key]?.length!==1||!sameRequestedValue(key,values[0],first.fields[key][0]))continue;
  mergeExtractedFields(fields,{[key]:values});consensus.add(key);
  if((fields[key]||[]).every(v=>sameRequestedValue(key,v,values[0])))verifiedFields.add(key);else verifiedFields.delete(key);
 }
 // Engine scores are not interchangeable: only high-confidence evidence from both passes verifies a field.
 const highFirst=paddleFields(paddle.passes[0].filter(b=>b.confidence>=90)).fields;
 const highSecond=paddleFields(paddle.passes[1].filter(b=>b.confidence>=90)).fields;
 for(const key of consensus)if(!verified.includes(key)&&!(highFirst[key]?.length===1&&highSecond[key]?.length===1&&sameRequestedValue(key,highFirst[key][0],highSecond[key][0])))verifiedFields.delete(key);
 return {fields,verifiedFields:[...verifiedFields],text:[first.text,second.text].filter(Boolean).join('\n\n')};
}
