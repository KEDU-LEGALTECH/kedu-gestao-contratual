import {spawn} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {freemem} from 'node:os';
import {fieldsFromLines} from './processing-extract.js';
import {recoverTextFields} from './text-recovery.js';
import {acquireReadingLease} from './reading-runtime-lock.js';
export type DoclingResult={ok:boolean;reason?:string;page:number;text:string;fields:Record<string,string[]>;items:{text:string;page:number}[];nativeText?:boolean;seconds:number;queueSeconds?:number;readSeconds?:number;peakMemoryMB?:number;method:'Docling — estrutura do PDF'};
export function doclingConfig(){
 try{const c=JSON.parse(readFileSync(resolve('data/docling-runtime.json'),'utf8'));return {ready:c.ready===true&&existsSync(c.python)&&existsSync(c.models),python:String(c.python),models:String(c.models),version:String(c.version||'')};}catch{return {ready:false,python:'',models:'',version:''};}
}
/** Local, bounded, opt-in fallback. Neither reference values nor credentials enter the child. */
export async function readDoclingPage(bytes:Buffer,page:number,options:{pilot?:boolean;timeoutMs?:number}={}):Promise<DoclingResult>{
 const started=Date.now();const failure=(reason:string):DoclingResult=>({ok:false,reason,page,text:'',fields:{},items:[],seconds:Math.round((Date.now()-started)/1000),method:'Docling — estrutura do PDF'});
 if(!Number.isInteger(page)||page<1||page>200||bytes.length>20*1024*1024||bytes.subarray(0,5).toString()!=='%PDF-')return failure('PDF ou página inválidos.');
 if(!options.pilot&&process.env.DOCUMENT_DOCLING_ENABLED!=='true')return failure('Docling ainda está em avaliação; leitura automática desativada.');
 const config=doclingConfig();if(!config.ready)return failure('Ambiente ou modelos do Docling ainda não estão preparados.');
 if(freemem()<1.5*1024**3)return failure('Memória disponível insuficiente para iniciar o Docling com segurança (mínimo 1,5 GB).');
 let release:(()=>void)|undefined;
 try{
  release=await acquireReadingLease();
  if(freemem()<1.5*1024**3)return failure('Memória insuficiente após aguardar a fila.');
  const readingStarted=Date.now();
  const result:any=await new Promise((resolveResult)=>{
   const environment=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(?:PATH|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|LOCALAPPDATA|APPDATA|COMSPEC|PROGRAMDATA|NUMBER_OF_PROCESSORS|LANG|LC_ALL)$/i.test(key)));
   const child=spawn(config.python,['-u',resolve('server/ocr/docling_worker.py')],{cwd:process.cwd(),windowsHide:true,env:{...environment,PYTHONUTF8:'1',HF_HOME:resolve('data/docling-models/hf'),HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',OMP_NUM_THREADS:'2',MKL_NUM_THREADS:'2',CUDA_VISIBLE_DEVICES:'',DOCLING_MODELS:config.models},stdio:['pipe','pipe','ignore']});
   let output='',done=false;
   const finish=(value:any)=>{if(done)return;done=true;clearTimeout(timer);child.kill();resolveResult(value);};
   const timer=setTimeout(()=>finish({error:'Tempo limite do leitor complementar excedido.'}),Math.min(options.timeoutMs||90000,120000));
   child.on('error',()=>finish({error:'Não foi possível iniciar o Docling.'}));
   child.stdout.setEncoding('utf8');
   child.stdout.on('data',chunk=>{output+=chunk.toString('utf8');if(output.length>4_000_000)finish({error:'Resposta do leitor excedeu o limite.'});});
   child.on('exit',()=>{try{finish(JSON.parse(output));}catch{finish({error:'O Docling não concluiu a leitura; o resultado anterior foi preservado.'});}});
   child.stdin.on('error',()=>finish({error:'Falha ao enviar o PDF ao leitor local.'}));
   child.stdin.end(JSON.stringify({bytes:bytes.toString('base64'),page}));
  });
  if(result.error)return failure(String(result.error)+(options.pilot&&result.detail?' — '+String(result.detail):''));
  if(typeof result.text!=='string'||!Array.isArray(result.items)||result.items.length>10000)return failure('Resposta inválida do leitor complementar.');
  const items=result.items.filter((i:any)=>i&&i.page===page&&typeof i.text==='string'&&i.text.length<100000);
  const text:string=result.text.slice(0,500000);
  const fields=fieldsFromLines(text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean));
  return {ok:!!text.trim(),reason:text.trim()?undefined:'Nenhum texto nativo encontrado; mantenha a leitura por OCR.',page,text,fields:{...fields,...recoverTextFields(text,fields)},items,nativeText:result.nativeText===true,seconds:Math.round((Date.now()-started)/1000),queueSeconds:Math.round((readingStarted-started)/1000),readSeconds:Math.round((Date.now()-readingStarted)/1000),peakMemoryMB:Number.isFinite(result.peakMemoryMB)?result.peakMemoryMB:undefined,method:'Docling — estrutura do PDF'};
 }catch{return failure('Leitor complementar indisponível; resultados anteriores preservados.');}finally{release?.();}
}
