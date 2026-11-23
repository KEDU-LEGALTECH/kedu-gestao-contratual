import { fork,type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { existsSync,mkdirSync,readdirSync,readFileSync } from "node:fs";
import { dirname,join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { extractProcessingFile,fieldsFromLines } from "./processing-extract.js";
import {interruptedReading} from './reading-policy.js';
import PizZip from 'pizzip';
import {readingFilename} from './reading-format.js';
import {acquireReadingLease} from './reading-runtime-lock.js';
import {freemem,tmpdir} from 'node:os';
import {recoverTextFields} from './text-recovery.js';
import type {Sql} from './sql.js';
import {paddleRuntimePath,readerAvailable} from './paddle-ocr.js';
export const readerVersion=4;
export const supportedReading=/\.(docx|doc|pdf|png|jpe?g|webp|tiff?|bmp|gif|txt|csv|odt|xlsx|pptx)$/i;
export type Reading={version:number;text:string;fields:Record<string,string[]>;problem:string;method:string;needsReview:boolean;incomplete?:boolean;completedPages?:number[];pendingPages?:number[];confidence?:number;fieldConfidence?:Record<string,number>;pages?:number;formulaCount?:number;warnings?:string[];verifiedFields?:string[];digitalFields?:Record<string,string[]>;tableFields?:Record<string,string[]>;ocrEngine?:string;preprocessing?:string[];calculatedFields?:Record<string,string[]>;transient?:boolean;awaitingOcr?:boolean;fieldOrigins?:Record<string,{value:string;page:number;excerpt:string}[]>;timings?:{queueMs:number;readMs:number;shutdownMs:number;totalMs:number;cacheHit?:boolean}};
export function readingFailure(problem:string):Reading{return {version:readerVersion,text:"",fields:{},problem,method:"inconclusiva",needsReview:false};}
/** A scan or image on a host without PaddleOCR: not a failure of the file, it waits for the OCR reader. */
export const awaitingOcrReading=():Reading=>({...readingFailure("Aguardando leitura com OCR: este arquivo é imagem ou digitalização e será lido na próxima rodada do OCR, de hora em hora, das 07h40 às 19h40. O original está disponível para consulta."),awaitingOcr:true});
let queue:Promise<unknown>=Promise.resolve();
/** Parsers and OCR run in a bounded child process; no remote OCR service. */
export type ReadingRegion={page:number;x:number;y:number;width:number;height:number;rotation:number;identification?:boolean};
export function validReadingRegion(region:ReadingRegion) {
 return region && Number.isInteger(region.page)&&region.page>=1&&region.page<=200&&[0,90,180,270].includes(region.rotation)&&[region.x,region.y,region.width,region.height].every(Number.isFinite)&&region.x>=0&&region.y>=0&&region.width>=0.02&&region.height>=0.02&&region.x+region.width<=1.000001&&region.y+region.height<=1.000001;
}
export type ReadingOptions = {deadline?: number; pageStore?: Sql};
export async function readProcessingFile(bytes:Buffer,name:string,region?:ReadingRegion,identification=false,options:ReadingOptions={}):Promise<Reading> {
 const queued=performance.now();
 const task=async()=>{
  let release:(()=>void)|undefined,started:number|undefined;
  try{
   release=await acquireReadingLease(options.deadline);started=performance.now();
   const reading=await readSingleFile(bytes,name,region,identification,options);
   if(!reading.problem){
    const recovered=recoverTextFields(reading.text,reading.fields||{});
    reading.fields={...reading.fields,...recovered};
    if(!reading.incomplete&&['Texto do PDF','DOCX','Texto'].includes(reading.method))reading.digitalFields={...reading.digitalFields,...recovered};
   }
   const finished=performance.now();
   return {...reading,timings:{queueMs:Math.round(started-queued),readMs:reading.timings?.readMs??Math.round(finished-started),shutdownMs:reading.timings?.shutdownMs||0,totalMs:Math.round(finished-queued),cacheHit:reading.timings?.cacheHit||false}};
  }catch{const finished=performance.now();return {...readingFailure('O leitor está temporariamente indisponível. A leitura anterior foi preservada para nova tentativa.'),transient:true,timings:{queueMs:Math.round((started??finished)-queued),readMs:started?Math.round(finished-started):0,shutdownMs:0,totalMs:Math.round(finished-queued)}};}
  finally{release?.();}
 };
 const pending=queue.then(task,task);queue=pending.then(()=>{},()=>{});return pending;
}
async function readSingleFile(bytes:Buffer,name:string,region:ReadingRegion|undefined,identification:boolean,options:ReadingOptions):Promise<Reading> {
 if(!bytes.length)return readingFailure("O arquivo recebido está vazio. Obtenha uma cópia legível.");
 if(bytes.length>20*1024*1024)return readingFailure("O arquivo excede o limite de leitura de 20 MB. Separe o documento em partes para conferência.");
 const detected=readingFilename(bytes,name);if(detected!==name)name=name.replace(/\.[^./\\]+$/,'')+'.'+detected.split('.').pop();
 if(region && (!validReadingRegion(region)||!/\.(pdf|png|jpe?g|webp|tiff?|bmp|gif)$/i.test(name)))return readingFailure('Selecione uma região válida de um PDF ou imagem.');
 if(!supportedReading.test(name))return readingFailure("Formato sem leitor disponível. O original foi preservado; envie PDF, imagem, Word, ODT, XLSX, PPTX, TXT ou CSV para análise.");
 if(/\.docx$/i.test(name)){
  const extracted=extractProcessingFile(bytes,name);
  if(extracted.problem&&extracted.problem!=='O documento está vazio ou contém apenas imagens.')return {...extracted,version:readerVersion,method:'DOCX',needsReview:false};
  const embedded=Object.keys(new PizZip(bytes).files).some(n=>/^word\/media\/.+\.(png|jpe?g|webp|bmp|tiff?)$/i.test(n));
  if(!embedded)return {...extracted,version:readerVersion,method:'DOCX',needsReview:false};
 }
 if(/\.(txt|csv)$/i.test(name)) {
  const text=(bytes[0]===255 && bytes[1]===254?bytes.subarray(2).toString("utf16le"):bytes.toString("utf8")).replace(/^\uFEFF/,"");
  if(text.length>500000 || /\x00|\uFFFD/.test(text))return readingFailure("Texto muito grande ou codificação não reconhecida. Salve como UTF-8.");
  return {version:readerVersion,text,fields:fieldsFromLines(text.split(/\r?\n/).map(x=>x.replace(/[;\t]/g,": "))),problem:text.trim()?"":"Nenhum texto legível foi encontrado.",method:"Texto",needsReview:false};
 }
 // Hosted API without PaddleOCR: digital text is read here, in the same process; scans and images wait.
 if(!readerAvailable()){
  try{return await (await import("./file-reading-engine.js")).readDigitalOnly(bytes,name,region,identification)??awaitingOcrReading();}
  catch(e:any){return readingFailure(e?.message||"Não foi possível ler o arquivo. Confira se está íntegro e sem senha.");}
 }
 const key=region||identification?undefined:createHash("sha256").update(bytes).digest("hex")+"\0"+name;
 const cached=key?cachedReading(key):undefined;
 if(cached)return {...cached,timings:{queueMs:0,readMs:0,shutdownMs:0,totalMs:0,cacheHit:true}};
 if(process.env.NODE_ENV!=='test'&&!process.env.NODE_TEST_CONTEXT&&freemem()<512*1024*1024)return {...readingFailure('Memória disponível insuficiente; leitura adiada para preservar a estabilidade.'),transient:true};
 const pageStore=!region&&!identification&&/\.pdf$/i.test(name)?options.pageStore:undefined;
 const originalHash=pageStore?createHash('sha256').update(bytes).digest('hex'):'';
 const pageFingerprint=pageStore?readerFingerprint()+(/cart[aã]o|cnpj/i.test(name)?':registration':':standard'):'';
 const savedPages: Record<number,Reading>={};
 if(pageStore){
  const cutoff=new Date(Date.now()-30*86400000).toISOString();
  await pageStore.run('DELETE FROM reading_pages WHERE created<?',cutoff);
  for(const row of await pageStore.all('SELECT page,reading FROM reading_pages WHERE original_hash=? AND reader_fingerprint=?',originalHash,pageFingerprint))
   savedPages[Number(row.page)]=JSON.parse(row.reading);
 }
 const remaining=Math.min(180000,(options.deadline??Infinity)-Date.now());
 if(remaining<=0)return {...readingFailure('Ciclo encerrado; nova tentativa pendente.'),transient:true};
 const task=()=>new Promise<Reading>(resolve=>{
  const started=performance.now();
  const current=acquireWorker(),child=current.child;
  let done=false,partial:Reading|undefined;
  let writes=Promise.resolve(),saveFailed=false;
  const finish=async(result:Reading,healthy:boolean,rss=0)=>{
   if(done)return;done=true;clearTimeout(timer);
   child.off("message",onMessage);child.off("error",onError);child.off("exit",onExit);
   const readMs=Math.round(performance.now()-started),shutdown=performance.now();
   if(healthy&&rss<256*1024*1024)await releaseWorker(current);else await retireWorker(current);
   await writes;
   if(saveFailed)result={...result,transient:true,problem:'Não foi possível salvar o progresso da leitura no banco.'};
   if(key)storeReading(key,result);
   resolve({...result,timings:{queueMs:0,readMs,shutdownMs:Math.round(performance.now()-shutdown),totalMs:Math.round(performance.now()-started)}});
  };
  const timer=setTimeout(()=>{
   const reason='Leitura interrompida pelo limite de tempo.';
   const result=partial?.text?interruptedReading(partial,reason):readingFailure(reason);
   void finish({...result,transient:remaining<180000||result.transient},false);
  },remaining);
  const onMessage=(result:any)=>{
   if(result.partial){partial=result.partial;return;}
   if(result.pageReading){
    const {page,reading}=result.pageReading as {page:number;reading:Reading};
    if(pageStore&&cacheableReading(reading))writes=writes.then(async()=>{
     await pageStore.run('INSERT INTO reading_pages(original_hash,reader_fingerprint,page,reading,created) VALUES(?,?,?,?,?) ON CONFLICT(original_hash,reader_fingerprint,page) DO NOTHING',originalHash,pageFingerprint,page,JSON.stringify(reading),new Date().toISOString());
    }).catch(()=>{saveFailed=true;});
    return;
   }
  const {readerRssBytes,...reading}=result;
  if(remaining<180000&&reading.incomplete&&Date.now()>=options.deadline!-2000)reading.transient=true;
   void finish(reading.problem && partial?.text?{...interruptedReading(partial,'Leitura incompleta: '+reading.problem),transient:reading.transient}:reading,true,readerRssBytes);
  };
  // Engine start failures and crashed workers (e.g. memory pressure) say nothing about the file itself.
  const onError=()=>finish({...readingFailure("O leitor local não pôde ser iniciado. Tente novamente."),transient:true},false);
  const onExit=()=>finish(partial?.text?{...interruptedReading(partial,'Leitura parcial: o leitor foi interrompido antes de concluir o arquivo.'),transient:true}:{...readingFailure("Não foi possível concluir a leitura deste arquivo. Confira se está íntegro e sem senha."),transient:true},false);
  child.on("message",onMessage);child.on("error",onError);child.on("exit",onExit);
  child.send({bytes,name,region,identification,deadline:options.deadline,savedPages,durablePages:!!pageStore},error=>{if(error)onError();});
 });
 return task();
}
/** One reader process serves consecutive files, so OCR models load once. It is replaced after a
 * failure or time limit, after a fixed number of files, and closed when idle. */
const filesPerWorker=5,idleWorkerMs=15000;
type Worker={child:ChildProcess;files:number;idle?:ReturnType<typeof setTimeout>};
let worker:Worker|undefined;
function acquireWorker() {
 if(!worker){
  const child=fork(fileURLToPath(new URL("./file-reading-worker.ts",import.meta.url)),[],{execArgv:["--import","tsx","--max-old-space-size=512"],serialization:"advanced",stdio:["ignore","ignore","ignore","ipc"]});
  const created:Worker={child,files:0};worker=created;
  child.on("error",()=>{});
  child.on("exit",()=>{clearTimeout(created.idle);if(worker===created)worker=undefined;});
 }
 clearTimeout(worker.idle);worker.child.ref();(worker.child as any).channel?.ref?.();
 return worker;
}
async function retireWorker(current:Worker) {
 clearTimeout(current.idle);if(worker===current)worker=undefined;
 if(current.child.exitCode!==null||current.child.signalCode!==null)return;
 await new Promise<void>(resolve=>{let timer:ReturnType<typeof setTimeout>;const done=()=>{clearTimeout(timer);current.child.off('exit',done);resolve();};current.child.once('exit',done);timer=setTimeout(done,2000);current.child.kill();});
}
async function releaseWorker(current:Worker) {
 if(++current.files>=filesPerWorker){await retireWorker(current);return;}
 // An idle reader must not keep the server, scripts or tests alive.
 current.child.unref();(current.child as any).channel?.unref?.();
 current.idle=setTimeout(()=>retireWorker(current),idleWorkerMs);current.idle.unref();
}
/** Completed readings are reused for identical bytes and name while the reader code and OCR setup stay the same.
 * Failures, partial readings and readings without the configured OCR engine are always repeated. */
let cache:DatabaseSync|null|undefined,fingerprint="",computedFingerprint:string|undefined;
// The worker never imports these files: changing them must not discard saved OCR pages.
const outsideReader=/^server[\\/](?:index|glpi|glpi-sync|glpi-download|glpi-intake|glpi-schedule|glpi-check|contract-processing|processing-routes|reading-job-queue|backup|backup-service|backup-verify|readiness)\.ts$/;
function readerFingerprint() {
 if(computedFingerprint)return computedFingerprint;
 const root=fileURLToPath(new URL("..",import.meta.url)),hash=createHash("sha256");
 const files=[...["server","shared"].flatMap(folder=>(readdirSync(join(root,folder),{recursive:true}) as string[]).filter(f=>/\.(ts|py)$/.test(f)).map(f=>join(folder,f)).filter(f=>!outsideReader.test(f))),"package-lock.json","data/ocr-runtime.json"].sort();
 for(const file of files)if(existsSync(join(root,file)))hash.update(file+"\0").update(readFileSync(join(root,file)));
 const runtime=paddleRuntimePath();
 if(existsSync(runtime))hash.update(readFileSync(runtime));
 return computedFingerprint=hash.update(String(readerVersion)+(process.env.OCR_ENGINE||"")).digest("hex");
}
function readingCache() {
 if(cache!==undefined)return cache;
 const path=process.env.READING_CACHE_PATH;
 if(process.env.READING_CACHE==="off"||(!path&&(process.env.NODE_ENV==="test"||process.env.NODE_TEST_CONTEXT)))return cache=null;
 try{
  const file=path||(process.env.VERCEL?join(tmpdir(),"kedu-reading-cache.sqlite"):"data/reading-cache.sqlite");mkdirSync(dirname(file),{recursive:true});
  const db=new DatabaseSync(file);fingerprint=readerFingerprint();
  db.exec("PRAGMA journal_mode=WAL;PRAGMA busy_timeout=5000;CREATE TABLE IF NOT EXISTS readings(key TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,reading TEXT NOT NULL,created TEXT NOT NULL)");
  // Extracted text is personal data: keep it only while useful.
  db.prepare("DELETE FROM readings WHERE fingerprint<>? OR created<?").run(fingerprint,new Date(Date.now()-30*86400000).toISOString());
  cache=db;
 }catch{cache=null;}
 return cache;
}
function cachedReading(key:string):Reading|undefined {
 try{const row=readingCache()?.prepare("SELECT reading FROM readings WHERE key=? AND fingerprint=?").get(key,fingerprint) as any;return row?JSON.parse(row.reading):undefined;}
 catch{return undefined;}
}
function cacheableReading(reading:Reading) {
 return !reading.problem&&!reading.incomplete&&!reading.transient&&!reading.warnings?.some(w=>/indispon[íi]vel/i.test(w));
}
function storeReading(key:string,reading:Reading) {
 if(!cacheableReading(reading))return;
 try{readingCache()?.prepare("INSERT OR REPLACE INTO readings VALUES(?,?,?,?)").run(key,fingerprint,JSON.stringify(reading),new Date().toISOString());}catch{}
}
/** Completed page OCR survives a file deadline; partial pages are never reused. */
export function cachedPdfPage(originalHash:string,page:number){return cachedReading(`pdf-page:${originalHash}:${page}`);}
export function storePdfPage(originalHash:string,page:number,reading:Reading){storeReading(`pdf-page:${originalHash}:${page}`,reading);}
