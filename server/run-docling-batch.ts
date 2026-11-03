import 'dotenv/config';
import {DatabaseSync} from 'node:sqlite';
import {spawn,execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,existsSync,copyFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {freemem} from 'node:os';
import {createVerifiedBackup} from './backup-service.js';
import {doclingConfig} from './docling-reader.js';
import {acquireReadingLease} from './reading-runtime-lock.js';
import {mergeTargetedReading} from './targeted-reading.js';
import {fieldsFromLines} from './processing-extract.js';
import {recoverTextFields} from './text-recovery.js';
import {fieldsForRole} from './reading-policy.js';
const apply=process.argv.includes('--apply');
const config=doclingConfig();if(!config.ready)throw Error('Docling não está preparado.');
const livePath=resolve(process.env.DATABASE_PATH||'data/kedu.sqlite');
const folder=resolve('data/docling-batches/'+new Date().toISOString().replace(/[:.]/g,'-'));mkdirSync(folder,{recursive:true});
const sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const live=new DatabaseSync(livePath);live.exec('PRAGMA busy_timeout=10000');
const previousPause=(live.prepare('SELECT value FROM settings WHERE key=?').get('documentReadingPaused') as any)?.value;
const owner=randomUUID();let release:(()=>void)|undefined,clone:any,child:ReturnType<typeof spawn>|undefined,pending:((r:any)=>void)|undefined,timer:ReturnType<typeof setTimeout>|undefined,buffer='';
function closeReader(){child?.kill();child=undefined;buffer='';}
function readPage(bytes:Buffer,page:number):Promise<any>{
 if(pending)throw Error('Docling deve processar uma página por vez.');
 return new Promise(resolveResult=>{
  if(!child){
   if(freemem()<1.5*1024**3){resolveResult({error:'Memória insuficiente para iniciar o Docling'});return;}
   const environment=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(?:PATH|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|LOCALAPPDATA|APPDATA|COMSPEC|PROGRAMDATA|NUMBER_OF_PROCESSORS|LANG|LC_ALL)$/i.test(key)));
   child=spawn(config.python,['-u',resolve('server/ocr/docling_worker.py'),'--persistent'],{windowsHide:true,cwd:process.cwd(),env:{...environment,PYTHONUTF8:'1',HF_HOME:resolve('data/docling-models/hf'),HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',OMP_NUM_THREADS:'2',MKL_NUM_THREADS:'2',CUDA_VISIBLE_DEVICES:'',DOCLING_MODELS:config.models},stdio:['pipe','pipe','ignore']});
   const instance=child;
   child.stdout!.setEncoding('utf8');
   child.stdout!.on('data',chunk=>{
    if(child!==instance)return;
    buffer+=chunk;if(buffer.length>4_000_000){pending?.({error:'Resposta excedeu o limite'});pending=undefined;clearTimeout(timer);closeReader();return;}
    const at=buffer.indexOf('\n');if(at<0)return;const line=buffer.slice(0,at);buffer=buffer.slice(at+1);
    const done=pending;pending=undefined;clearTimeout(timer);try{done?.(JSON.parse(line));}catch{done?.({error:'Resposta inválida'});}
   });
   child.on('exit',()=>{if(child!==instance)return;const done=pending;pending=undefined;child=undefined;buffer='';clearTimeout(timer);done?.({error:'Leitor interrompido; leitura anterior preservada'});});
   child.on('error',()=>{if(child!==instance)return;pending?.({error:'Não foi possível iniciar o Docling'});pending=undefined;clearTimeout(timer);closeReader();});
   child.stdin!.on('error',()=>{if(child!==instance)return;pending?.({error:'Falha no leitor local'});pending=undefined;clearTimeout(timer);closeReader();});
  }
  pending=resolveResult;timer=setTimeout(()=>{const done=pending;pending=undefined;closeReader();done?.({error:'Página excedeu 120 segundos'});},120000);
  child!.stdin!.write(JSON.stringify({bytes:bytes.toString('base64'),page})+'\n');
 });
}
const labels:Record<string,RegExp>={cnpj:/cnpj|pessoa juridica/,razaoSocial:/razao social|nome empresarial|contratante|contratada|sociedade|pessoa juridica/,nomeFantasia:/fantasia|titulo do estabelecimento/,endereco:/endereco|logradouro|sede/,rua:/logradouro|endereco|sede/,numero:/numero|endereco|logradouro/,bairro:/bairro|distrito|endereco/,cidade:/municipio|cidade|localizacao|sede/,estado:/\buf\b|estado|localizacao|sede/,cep:/\bcep\b|postal/,banco:/banco|instituicao|dados bancarios/,agencia:/agencia|\bag\b/,conta:/conta|\bcc\b/,titularConta:/titular|favorecido|beneficiario|cliente|dados bancarios/,documentoTitular:/cnpj|cpf|titular|dados bancarios/,pix:/pix/,representanteNome:/representante|representad|administrad|outorgad/,representanteCpf:/cpf|representante|administrad/,remuneracao:/remuneracao|taxa|percentual/,garantia:/garantia/,repasse:/repasse|pagamento/,valor:/valor|principal/,valorTotal:/valor|total/,valorParcela:/parcela/,parcelas:/parcelas|plano|meses/};
const fold=(v:string)=>v.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/\s+/g,' ');
Object.assign(labels,{inicio:/vigencia|inicio|prazo/,fim:/vigencia|termino|encerramento/,dataFormalizacao:/formalizacao|assinatura|celebrado/,dataAssinaturaMatriz:/assinatura|celebrado/,duracaoMeses:/vigencia|meses|duracao/,diaRepasse:/repasse|pagamento/,diaRepasseSegundo:/repasse|pagamento/,repasseSegundo:/repasse|pagamento/,cashback:/cashback|cash back/,cashbackValor:/cashback|cash back/,modalidade:/modalidade|garantia/,alunos:/alunos|alunado/,incorporaMatricula:/matricula/});
const stages=(rows:any[])=>rows.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{} as Record<string,number>);
const fieldCounts=(rows:any[])=>rows.flatMap(r=>r.comparisons).reduce((a,c)=>(a[c.status]=(a[c.status]||0)+1,a),{} as Record<string,number>);
try{
 const backup=await createVerifiedBackup(livePath);console.log(JSON.stringify({backup:backup.path,folder}));
 if(apply){live.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run('doclingBatchPauseOwner',owner);live.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run('documentReadingPaused','true');}
 const snapshot=join(folder,'snapshot.sqlite');copyFileSync(backup.path,snapshot);
 process.env.NODE_ENV='test';process.env.DEMO_SEED='false';process.env.DATABASE_PATH=snapshot;process.env.READING_LOCK_PATH=resolve('data/reading-runtime.lock');
 const {db,all,one,run}=await import('./db.js');clone=db;
 const {saveProcessingResult}=await import('./contract-processing.js');
 const rows=all("SELECT d.id,d.glpi_id FROM demands d JOIN glpi_tickets t ON t.external_id=d.glpi_id JOIN contract_processing p ON p.demand_id=d.id WHERE t.mode='real' AND d.stage NOT IN('Concluído','Cancelado','Em assinatura') ORDER BY d.id");
 const before:any[]=[],candidates:any[]=[],skipped:any[]=[],originals=new Map<string,any>();
 for(const d of rows){
  const plan=saveProcessingResult(d.id);if(!plan)continue;before.push({id:d.id,glpi:d.glpi_id,status:plan.status,comparisons:plan.comparisons});
  const pendingFields=plan.comparisons.filter(c=>['missing','review'].includes(c.status)&&!c.partlyMatches&&!['conflicting_values','trade_name','qualified_name','spreadsheet_calculation'].includes(c.reviewReason?.code));
  if(!pendingFields.length)continue;
  for(const file of plan.files){
   if(!/\.pdf$/i.test(file.name)||!file.available)continue;
   if(['counterproposal','simulation','report'].includes(file.role)){skipped.push({demand:d.id,file:file.name,reason:'Documento de apoio/alternativas: não adota condições automaticamente'});continue;}
   const saved=one('SELECT id,extracted,problem,ticket_hash,length(bytes) byteLength FROM processing_files WHERE id=?',file.id);if(!saved||saved.problem||saved.byteLength>20*1024*1024)continue;
   const hash=sha(saved.extracted);
   if(one('SELECT file_id FROM processing_file_reviews WHERE file_id=? AND extraction_hash=?',file.id,hash))continue;
   const protectedFields=all('SELECT field FROM processing_field_reviews WHERE file_id=? AND extraction_hash=?',file.id,hash).map(r=>r.field);
   const fields=pendingFields.filter(c=>!protectedFields.includes(c.field)&&Object.hasOwn(fieldsForRole(file.role,{[c.field]:['value']}),c.field)&&labels[c.field]&&(c.status==='missing'||file.fieldReviews?.some(r=>r.key===c.field&&r.values.length))).map(c=>c.field);
   if(!fields.length)continue;
   const candidate={id:file.id,demand:d.id,glpi:d.glpi_id,name:file.name,fields,reading:JSON.parse(saved.extracted),extracted:saved.extracted,ticketHash:saved.ticket_hash};
   originals.set(file.id,candidate);candidates.push(candidate);
  }
 }
 writeFileSync(join(folder,'before.json'),JSON.stringify(before));writeFileSync(join(folder,'selection.json'),JSON.stringify(candidates.map(c=>({id:c.id}))));
 execFileSync(config.python,[resolve('server/ocr/docling_inventory.py'),snapshot,join(folder,'selection.json'),join(folder,'inventory.json')],{windowsHide:true,timeout:120000,maxBuffer:1_000_000});
 const inventory=JSON.parse(readFileSync(join(folder,'inventory.json'),'utf8'));
 const tasks:any[]=[];
 for(const c of candidates){
  const native=inventory.find((r:any)=>r.id===c.id);
  const selected=(native?.pages||[]).filter((p:any)=>p.text.trim().length>=20).map((p:any)=>({page:p.page,fields:c.fields.filter((key:string)=>labels[key].test(fold(p.text))||c.reading.fieldOrigins?.[key]?.some((o:any)=>o.page===p.page))})).filter((p:any)=>p.fields.length);
  if(!selected.length){skipped.push({demand:c.demand,file:c.name,reason:native?.error?'PDF não acessível no leitor nativo':'Sem texto nativo ou rótulo dos campos pendentes; depende de OCR'});continue;}
  tasks.push({...c,pages:selected});
 }
 writeFileSync(join(folder,'plan.json'),JSON.stringify({files:tasks.map(t=>({demand:t.demand,file:t.name,pages:t.pages})),skipped},null,2));
 console.log(JSON.stringify({eligibleDemands:new Set(tasks.map(t=>t.demand)).size,eligibleFiles:tasks.length,pages:tasks.reduce((n,t)=>n+t.pages.length,0),skipped:skipped.length}));
 release=await acquireReadingLease();
 const cache=new Map<string,any>(),attempts:any[]=[],modified=new Map<string,string>();let completed=0;
 for(const task of tasks){
  const bytes=Buffer.from(one('SELECT bytes FROM processing_files WHERE id=?',task.id).bytes),bytesHash=sha(bytes);
  let reading=JSON.parse(task.extracted);
  for(const target of task.pages){
   const key=bytesHash+':'+target.page,started=Date.now();let output=cache.get(key),cached=!!output;
   if(!output){output=await readPage(bytes,target.page);cache.set(key,output);}
   let result:any={problem:output.error||'',text:output.text||'',fields:{},nativeText:output.nativeText===true,method:'Docling — estrutura do PDF'};
   if(!output.error&&output.text){const extracted=fieldsFromLines(output.text.split(/\r?\n/).map((s:string)=>s.trim()).filter(Boolean));result.fields={...extracted,...recoverTextFields(output.text,extracted)};}
   const signature=sha(JSON.stringify(['docling-batch-v1',bytesHash,target.page,target.fields]));
   reading=mergeTargetedReading(reading,result,{...target,signature});
   attempts.push({demand:task.demand,file:task.name,page:target.page,fields:target.fields,error:output.error,seconds:Math.round((Date.now()-started)/1000),peakMemoryMB:output.peakMemoryMB,cached});
   writeFileSync(join(folder,'attempts.json'),JSON.stringify(attempts,null,2));
   console.log(JSON.stringify({pageDone:++completed,file:task.name,page:target.page,seconds:Math.round((Date.now()-started)/1000),error:output.error||null}));
  }
  const next=JSON.stringify(reading);run('UPDATE processing_files SET extracted=? WHERE id=?',next,task.id);
  run('UPDATE processing_field_reviews SET extraction_hash=? WHERE file_id=? AND extraction_hash=?',sha(next),task.id,sha(task.extracted));
  modified.set(task.id,next);writeFileSync(join(folder,'reading-'+task.id+'.json'),next);
 }
 closeReader();release();release=undefined;
 const after=before.map(previous=>{const next=saveProcessingResult(previous.id)!;return {id:previous.id,glpi:previous.glpi,status:next.status,comparisons:next.comparisons};});
 const changes=after.flatMap(next=>{const old=before.find(r=>r.id===next.id);return next.comparisons.flatMap((c:any)=>{const p=old.comparisons.find((r:any)=>r.field===c.field);return p&&(p.status!==c.status||p.found!==c.found)?[{demand:next.id,glpi:next.glpi,field:c.field,from:p.status,to:c.status,previous:p.found,found:c.found}]:[];});});
 const transitions=after.filter(r=>before.find(b=>b.id===r.id).status!==r.status).map(r=>({demand:r.id,glpi:r.glpi,from:before.find(b=>b.id===r.id).status,to:r.status}));
 const applied:any[]=[],notApplied:any[]=[];
 if(apply){
  const previousDatabase=process.env.DATABASE_PATH;clone.close();clone=undefined;process.env.DATABASE_PATH=livePath;
  for(const [id,extracted] of modified){
   const original=originals.get(id);live.exec('BEGIN IMMEDIATE');
   try{
    const current=live.prepare('SELECT * FROM processing_files WHERE id=?').get(id) as any;
    const ticket=live.prepare('SELECT hash FROM glpi_tickets WHERE external_id=?').get(original.glpi) as any;
    const full=live.prepare('SELECT file_id FROM processing_file_reviews WHERE file_id=? AND extraction_hash=?').get(id,sha(original.extracted));
    if(!current||current.extracted!==original.extracted||ticket?.hash!==original.ticketHash||full){notApplied.push({id,reason:'Documento, leitura ou confirmação mudou durante o lote'});live.exec('COMMIT');continue;}
    const oldReviews=live.prepare('SELECT field FROM processing_field_reviews WHERE file_id=? AND extraction_hash=?').all(id,sha(original.extracted)) as any[];
    if(oldReviews.some(r=>original.fields.includes(r.field))){notApplied.push({id,reason:'Campo confirmado durante o lote'});live.exec('COMMIT');continue;}
    live.prepare('UPDATE processing_files SET extracted=? WHERE id=?').run(extracted,id);
    live.prepare('UPDATE processing_field_reviews SET extraction_hash=? WHERE file_id=? AND extraction_hash=?').run(sha(extracted),id,sha(original.extracted));
    live.prepare("UPDATE contract_processing SET revision=revision+1,result=json_set(result,'$.fingerprint',?) WHERE demand_id=?").run('docling-batch-'+owner,original.demand);
    applied.push({id,demand:original.demand});live.exec('COMMIT');
   }catch(error){live.exec('ROLLBACK');throw error;}
  }
  process.env.DATABASE_PATH=previousDatabase;
 }
 const report={at:new Date().toISOString(),folder,examined:before.length,eligibleFiles:tasks.length,eligibleDemands:new Set(tasks.map(t=>t.demand)).size,pages:attempts.length,uniquePages:cache.size,failedPages:attempts.filter(a=>a.error).length,before:{stages:stages(before),fields:fieldCounts(before)},after:{stages:stages(after),fields:fieldCounts(after)},changes,transitions,skipped,applied,notApplied};
 writeFileSync(join(folder,'after.json'),JSON.stringify(after));writeFileSync(join(folder,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}finally{
 closeReader();release?.();clone?.close();
 if(apply&&(live.prepare('SELECT value FROM settings WHERE key=?').get('doclingBatchPauseOwner') as any)?.value===owner){
  if(previousPause===undefined)live.prepare('DELETE FROM settings WHERE key=?').run('documentReadingPaused');else live.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run('documentReadingPaused',previousPause);
  live.prepare('DELETE FROM settings WHERE key=?').run('doclingBatchPauseOwner');
 }
 live.close();
}
process.exit(0);
