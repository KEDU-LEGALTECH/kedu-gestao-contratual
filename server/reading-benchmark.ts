import "dotenv/config";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { existsSync,readFileSync,writeFileSync } from "node:fs";
import { extname } from "node:path";
import {sameRequestedValue} from "./request-expectations.js";
import { readingFilename } from "./reading-format.js";

// Measures the reader itself; a cached reading would hide changes and timing.
process.env.READING_CACHE="off";
const { readProcessingFile }=await import("./file-reading.js");

/** Local reference of expected fields per original. Kept under data/ (ignored by Git): it holds personal data.
 * `conferido: true` marks entries checked against the original; the others only detect changes. */
type GoldEntry={sha256:string;name:string;format:string;conferido:boolean;fields:Record<string,string[]>;observacao?:string};
const goldPath="data/reading-gold.json";
const args=process.argv.slice(2),option=(name:string)=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined;};
const seed=args.includes("--seed"),onlyFormat=option("--format"),limit=Number(option("--limit")||Infinity);

const db=new DatabaseSync(process.env.DATABASE_PATH||"data/kedu.sqlite",{readOnly:true});
const originals=new Map<string,{name:string;bytes:Buffer}>();
for(const row of db.prepare("SELECT name,bytes FROM processing_files WHERE length(bytes)>0 ORDER BY created").all() as any[]){
 const bytes=Buffer.from(row.bytes),sha256=createHash("sha256").update(bytes).digest("hex");
 if(!originals.has(sha256))originals.set(sha256,{name:row.name,bytes});
}
const formatOf=(name:string,bytes:Buffer)=>extname(readingFilename(bytes,name)).slice(1).toLowerCase().replace("jpg","jpeg")||"(sem)";
const gold:GoldEntry[]=existsSync(goldPath)?JSON.parse(readFileSync(goldPath,"utf8")):[];
const known=new Map(gold.map(entry=>[entry.sha256,entry]));
const human=new Map<string,Record<string,string[]>>();
if(db.prepare("SELECT name FROM sqlite_master WHERE name='reading_gold_fields'").get()){
 for(const row of db.prepare('SELECT original_hash,field,value FROM reading_gold_fields ORDER BY created,rowid').all() as any[]){
  const fields=human.get(row.original_hash)||{};fields[row.field]=[row.value];human.set(row.original_hash,fields);
 }
}
const same=(key:string,a:string[]=[],b:string[]=[])=>a.length===b.length&&a.every(x=>b.some(y=>sameRequestedValue(key,x,y)));

type Stats={arquivos:number;conferidos:number;camposEsperados:number;iguais:number;perdidos:number;divergentes:number;novos:number;problemas:number;ms:number;humanFields:number;humanCorrect:number};
const stats:Record<string,Stats>={},changes:string[]=[];
let processed=0;
for(const [sha256,original] of originals){
 const format=formatOf(original.name,original.bytes);
 if(onlyFormat&&format!==onlyFormat)continue;
 const baseline=known.get(sha256),reviewed=human.get(sha256);
 const entry=baseline?{...baseline,fields:{...baseline.fields,...reviewed}}:reviewed?{sha256,name:original.name,format,conferido:false,fields:reviewed}:undefined;
 if(!entry&&!seed)continue;
 if(processed++>=limit)break;
 const started=performance.now(),reading=await readProcessingFile(original.bytes,original.name),ms=performance.now()-started;
 const s=stats[format]||={arquivos:0,conferidos:0,camposEsperados:0,iguais:0,perdidos:0,divergentes:0,novos:0,problemas:0,ms:0,humanFields:0,humanCorrect:0};
 s.arquivos++;s.ms+=ms;if(reading.problem)s.problemas++;
 if(!entry){
  const added:GoldEntry={sha256,name:original.name,format,conferido:false,fields:reading.fields};
  gold.push(added);known.set(sha256,added);
  process.stdout.write(`referência criada: ${original.name} (${Math.round(ms)} ms)\n`);continue;
 }
 if(entry.conferido)s.conferidos++;
 for(const [key,expected] of Object.entries(reviewed||{})){s.humanFields++;if(same(key,expected,reading.fields[key]))s.humanCorrect++;}
 const notes:string[]=[];
 for(const [key,expected] of Object.entries(entry.fields)){
  s.camposEsperados++;
  const actual=reading.fields[key];
  if(!actual?.length){s.perdidos++;notes.push(`- ${key}: perdido ${JSON.stringify(expected)}`);}
  else if(same(key,expected,actual))s.iguais++;
  else{s.divergentes++;notes.push(`≠ ${key}: ${JSON.stringify(expected)} -> ${JSON.stringify(actual)}`);}
 }
 for(const key of Object.keys(reading.fields))if(!entry.fields[key]){s.novos++;notes.push(`+ ${key}: ${JSON.stringify(reading.fields[key])}`);}
 if(notes.length)changes.push(`${entry.conferido?"[conferido] ":""}${original.name}\n   ${notes.join("\n   ")}`);
}
if(seed)writeFileSync(goldPath,JSON.stringify(gold,null,1));

const pct=(n:number,d:number)=>d?Math.round(100*n/d)+"%":"-";
console.log("\nFormato  Arquivos  Conferidos  Campos  Iguais  Perdidos  Divergentes  Novos  Problemas  Tempo médio");
for(const [format,s] of Object.entries(stats).sort((a,b)=>b[1].arquivos-a[1].arquivos))
 console.log([format.padEnd(8),String(s.arquivos).padStart(8),String(s.conferidos).padStart(11),String(s.camposEsperados).padStart(7),pct(s.iguais,s.camposEsperados).padStart(7),String(s.perdidos).padStart(9),String(s.divergentes).padStart(12),String(s.novos).padStart(6),String(s.problemas).padStart(10),(Math.round(s.ms/s.arquivos)/1000).toFixed(1).padStart(10)+" s"].join(" "));
if(changes.length)console.log("\nDiferenças em relação à referência:\n"+changes.join("\n"));
else if(!seed)console.log("\nNenhuma diferença em relação à referência.");
const total=Object.values(stats).reduce((sum,s)=>sum+s.ms,0);
console.log(`\nTempo total de leitura: ${(total/1000).toFixed(1)} s${seed?` · referência salva em ${goldPath}`:""}`);
for(const [format,s] of Object.entries(stats))console.log(`${format}: gabarito humano ${s.humanCorrect}/${s.humanFields} campos corretos (${pct(s.humanCorrect,s.humanFields)}). Sem conferência humana, a comparação mede mudanças, não precisão.`);
db.close();
