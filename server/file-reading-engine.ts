import { createRequire } from "node:module";
import { dirname,join,extname } from "node:path";
import PizZip from "pizzip";
import { DOMParser } from "@xmldom/xmldom";
import sharp from "sharp";
import { createWorker,PSM } from "tesseract.js";
import {registrationFieldsFromLines,validCnpj,type LocatedField} from './registration-reading.js';
import { createCanvas } from "@napi-rs/canvas";
import { fieldsFromLines,fieldsFromRows,mergeExtractedFields,norm,normalizeValue,extractProcessingFile } from "./processing-extract.js";
import {positionedRows} from './table-reading.js';
import {extractContractParties} from './contract-parties.js';
import { preflight } from "./documents.js";
import { readerVersion,validReadingRegion,type Reading,type ReadingRegion } from "./file-reading.js";
import { prepareImage } from "./image-input.js";
import {needsPdfOcr} from './pdf-reading-policy.js';
import {recognizeWithPaddle,combineOcrFields,paddleConfigured} from './paddle-ocr.js';
const require=createRequire(import.meta.url);
const maxPages=30,maxText=500000;
function result(text:string,method:string,ocr=false,confidence?:number,pages=1):Reading {
 text=text.normalize("NFC").replace(/\x00/g,"");
 if(text.length>maxText)throw Error("Documento excede 500 mil caracteres; separe em partes.");
 return {version:readerVersion,text,fields:fieldsFromLines(text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean)),method,confidence,pages,needsReview:ocr && !!text.trim(),problem:text.trim()?"":"Nenhum texto legível foi reconhecido. Confira se o arquivo está em branco, desfocado ou cortado."};
}
async function ocrSession() {
 const language=require("@tesseract.js-data/por");
 const worker=await createWorker("por",1,{langPath:language.langPath,gzip:true,cacheMethod:"none",errorHandler:()=>{}});
 return worker;
}
async function recognizeImage(worker:Awaited<ReturnType<typeof ocrSession>>,png:Buffer) {
 const original=await worker.recognize(png);
 const enhanced=await sharp(png).grayscale().normalize().sharpen().png().toBuffer();
 const retry=await worker.recognize(enhanced);
 const data=retry.data.text.trim()&&retry.data.confidence>original.data.confidence?retry.data:original.data;
 const fields=(text:string)=>fieldsFromLines(text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean));
 const first=fields(original.data.text),second=fields(retry.data.text);
 const verifiedFields=Math.min(original.data.confidence,retry.data.confidence)>=85?Object.keys(first).filter(key=>first[key].length===1&&second[key]?.length===1&&norm(first[key][0])===norm(second[key][0])):[];
 return {...data,verifiedFields};
}
async function registrationRegions(worker:Awaited<ReturnType<typeof ocrSession>>,png:Buffer){
 const m=await sharp(png).metadata(),width=m.width!,height=m.height!,found:LocatedField[]=[];
 const transcripts:string[]=[];
 for(const mode of [PSM.SPARSE_TEXT,PSM.AUTO]){
  await worker.setParameters({tessedit_pageseg_mode:mode});
  const {data}=await worker.recognize(await sharp(png).resize({width:2800}).png().toBuffer(),{}, {text:true,blocks:true});
  for(const match of data.text.matchAll(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g))if(validCnpj(match[0]))found.push({key:'cnpj',value:match[0],confidence:data.confidence,excerpt:match[0]});
  for(const block of data.blocks||[])for(const p of block.paragraphs)for(const line of p.lines)for(const word of line.words)if(validCnpj(word.text))found.push({key:'cnpj',value:word.text,confidence:word.confidence,excerpt:line.text.trim()});
  transcripts.push(data.text.trim());
 }
 await worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_BLOCK});
 try{
  for(let band=0;band<6;band++)for(const rotation of [0,2]){
   const top=Math.floor(height*(.08+band*.08)),cropHeight=Math.min(height-top,Math.floor(height*.15));
   const crop=await sharp(png).extract({left:Math.floor(width*.04),top,width:Math.floor(width*.90),height:cropHeight}).resize({width:3200}).rotate(rotation,{background:'white'}).grayscale().normalize().threshold(145).png().toBuffer();
   const {data}=await worker.recognize(crop,{}, {text:true,blocks:true});
   const lines=data.blocks?.flatMap(b=>b.paragraphs.flatMap(p=>p.lines))||[];
   found.push(...registrationFieldsFromLines(lines));
   for(const line of lines)for(const word of line.words)if(validCnpj(word.text))found.push({key:'cnpj',value:word.text,confidence:word.confidence,excerpt:line.text.trim()});
   transcripts.push(data.text.trim());
  }
 }finally{await worker.setParameters({tessedit_pageseg_mode:PSM.AUTO});}
 const fields:Record<string,string[]>={},verifiedFields:string[]=[];
 for(const key of new Set(found.map(f=>f.key))){
  const candidates=found.filter(f=>f.key===key&&f.confidence>=(key==='cnpj'?60:80));
  const distinct=[...new Set(candidates.map(f=>normalizeValue(key,f.value)))];
  if(distinct.length){fields[key]=distinct;if(distinct.length===1&&candidates.filter(f=>f.confidence>=85).length>=2)verifiedFields.push(key);}
 }
 if(['rua','numero','bairro'].every(key=>fields[key]?.length===1)){
  fields.endereco=[fields.rua[0]+', '+fields.numero[0]+', '+fields.bairro[0]];
  if(['rua','numero','bairro'].every(key=>verifiedFields.includes(key)))verifiedFields.push('endereco');
 }
 return {fields,verifiedFields,text:transcripts.join('\n\n')};
}
async function enterpriseNameRegion(worker:Awaited<ReturnType<typeof ocrSession>>,bytes:Buffer){
 const png=await sharp(bytes,{limitInputPixels:24000000}).rotate().flatten({background:'white'}).resize({width:2800}).png().toBuffer();
 const m=await sharp(png).metadata();await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT});
 try{
  const {data}=await worker.recognize(png,{}, {text:true,blocks:true});
  const lines=data.blocks?.flatMap(b=>b.paragraphs.flatMap(p=>p.lines))||[];
  for(let i=0;i<lines.length-1;i++){
   if(!/^nome empresarial\W*$/i.test(norm(lines[i].text)))continue;
   const next=lines[i+1],b=next.bbox;
   if(b.y0<lines[i].bbox.y0||b.y0-lines[i].bbox.y1>100||next.words.length<2)continue;
   const left=Math.max(0,b.x0-8),top=Math.max(0,b.y0-8),width=Math.min(m.width!-left,b.x1-b.x0+16),height=Math.min(m.height!-top,b.y1-b.y0+16);
   const crop=await sharp(png).extract({left,top,width,height}).resize({width:1800}).png().toBuffer();
   const readings=[];await worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_LINE});
   for(const threshold of [100,130]){const r=await worker.recognize(await sharp(crop).grayscale().normalize().threshold(threshold).extend({top:25,bottom:25,left:25,right:25,background:'white'}).png().toBuffer());readings.push(r.data);}
   const value=readings[0].text.trim().replace(/^[|\s]+|[|\s]+$/g,'');
   if(readings.every(r=>r.confidence>=85&&norm(r.text.trim().replace(/^[|\s]+|[|\s]+$/g,''))===norm(value))&&/^[\p{L}\s&.'-]{5,180}$/u.test(value))return value;
  }
 }finally{await worker.setParameters({tessedit_pageseg_mode:PSM.AUTO});}
 return null;
}
async function image(bytes:Buffer,name='') {
 bytes=await prepareImage(bytes);
 const source=sharp(bytes,{limitInputPixels:24000000,failOn:"error"}),meta=await source.metadata();
 if(!meta.width || !meta.height)throw Error("Imagem inválida.");
 const count=meta.pages||1;if(count>maxPages)throw Error("Imagem contém mais de 30 páginas ou quadros; separe o arquivo.");
 const worker=await ocrSession();const texts:string[]=[],scores:number[]=[],verified:string[][]=[];let registration:Awaited<ReturnType<typeof registrationRegions>>|undefined,enterpriseName:string|null=null;
 try {
  for(let page=0;page<count;page++) {
   const png=await sharp(bytes,{page,pages:1,limitInputPixels:24000000}).rotate().flatten({background:"white"}).resize({width:2200,height:3000,fit:"inside",withoutEnlargement:false}).png().toBuffer();
   const data=await recognizeImage(worker,png);texts.push(data.text);scores.push(data.confidence);verified.push(data.verifiedFields);
   if(count===1&&/cart[aã]o.*cnpj|cadastro nacional da pessoa jur[ií]dica/i.test(name+'\n'+data.text))registration=await registrationRegions(worker,await sharp(bytes,{limitInputPixels:24000000}).rotate().flatten({background:'white'}).png().toBuffer());
   else if(count===1&&/contrato social|requerimento de empres[aá]rio/i.test(name+'\n'+data.text))enterpriseName=await enterpriseNameRegion(worker,bytes);
  }
 }finally{await worker.terminate();}
 const reading=result(texts.join("\n\n"),"OCR de imagem",true,Math.min(...scores),count);
 if(registration){reading.fields=registration.fields;reading.text+='\n\nLEITURA DOS BLOCOS DO CARTÃO CNPJ\n'+registration.text;reading.method='OCR de imagem e blocos cadastrais';}
 if(enterpriseName){reading.fields.razaoSocial=[enterpriseName];reading.text+='\n\nNOME EMPRESARIAL — RELEITURA DO BLOCO\n'+enterpriseName;verified[0].push('razaoSocial');}
 let verifiedFields=registration?registration.verifiedFields:count===1?verified[0]:[];
 const operations=new Set<string>();let paddleUsed=false;
 for(let page=0;page<count;page++){
  const png=await sharp(bytes,{page,pages:1,limitInputPixels:24000000}).rotate().flatten({background:'white'}).resize({width:2200,height:3000,fit:'inside',withoutEnlargement:true}).png().toBuffer();
  const paddle=await recognizeWithPaddle(png);if(!paddle)continue;
  paddleUsed=true;for(const operation of paddle.operations)operations.add(operation);
  const combined=combineOcrFields(reading.fields,verifiedFields,paddle);
  reading.fields=combined.fields;verifiedFields=count===1?combined.verifiedFields:[];
  reading.text+='\n\nLEITURA ADICIONAL — PADDLEOCR / OPENCV\n'+combined.text;
 }
 if(paddleUsed)reading.method+=' + PaddleOCR / OpenCV';
 return {...reading,verifiedFields,ocrEngine:paddleUsed?'Tesseract + PaddleOCR PP-OCRv5':'Tesseract',preprocessing:[...operations],warnings:paddleConfigured()&&!paddleUsed?['PaddleOCR indisponível nesta tentativa; leitura alternativa preservada.']:[]};
}
async function pdf(bytes:Buffer,progress?:(reading:Reading)=>void,nativeOnly=false,layerOnly=false) {
 const {getDocument}=await import("pdfjs-dist/legacy/build/pdf.mjs");
 const root=dirname(require.resolve("pdfjs-dist/package.json"));
 const loading=getDocument({data:new Uint8Array(bytes),useSystemFonts:false,standardFontDataUrl:join(root,"standard_fonts")+"/",cMapUrl:join(root,"cmaps")+"/",cMapPacked:true,wasmUrl:join(root,"wasm")+"/",verbosity:0});
 let document:any,worker:Awaited<ReturnType<typeof ocrSession>>|undefined;
 try {
  document=await loading.promise;
  if(document.numPages>maxPages)throw Error("PDF contém mais de 30 páginas. Separe o arquivo; nenhuma página foi ignorada na aprovação.");
  const texts:string[]=[],digitalTexts:string[]=[],scores:number[]=[],verified:string[][]=[];const tableFields:Record<string,string[]>={},ocrFields:Record<string,string[]>={};let usedOcr=false,paddleUsed=false;
  for(let n=1;n<=document.numPages;n++) {
   const page=await document.getPage(n),content=await page.getTextContent();
   let text="";
   for(const item of content.items as any[])if(typeof item.str==="string")text+=item.str+(item.hasEOL?"\n":" ");
   digitalTexts.push(text);
   mergeExtractedFields(tableFields,fieldsFromRows(positionedRows(content.items as any[])));
   // A page with sparse text may contain a scanned body below a digital header.
   const operators=await page.getOperatorList();
   const {OPS}=await import("pdfjs-dist/legacy/build/pdf.mjs");
   const hasImage=operators.fnArray.some((op:number)=>[OPS.paintImageXObject,OPS.paintInlineImageXObject,OPS.paintImageXObjectRepeat].includes(op));
   const basePage=page.getViewport({scale:1});
   const needsOcr=hasImage?needsPdfOcr(text,operators,OPS,basePage.width*basePage.height):text.trim().length<40;
   if(needsOcr && !layerOnly) {
    if(nativeOnly)throw Error(`Este PDF ainda precisa de OCR: página ${n}, ${text.trim().length} caracteres digitais.`);
    worker??=await ocrSession();
    const base=page.getViewport({scale:1});
    const scale=Math.min(2.5,3200/Math.max(base.width,base.height));
    if(!Number.isFinite(scale) || scale<=0)throw Error("Dimensão de página inválida.");
    const viewport=page.getViewport({scale});
    const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
    await page.render({canvas:canvas as any,canvasContext:canvas.getContext("2d") as any,viewport}).promise;
    const png=canvas.toBuffer('image/png');
    const recognition={data:await recognizeImage(worker,png)};
    const paddle=await recognizeWithPaddle(png);
    if(paddle){
     const combined=combineOcrFields(fieldsFromLines(recognition.data.text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean)),recognition.data.verifiedFields,paddle);
     mergeExtractedFields(ocrFields,combined.fields);recognition.data.text+='\n'+combined.text;recognition.data.verifiedFields=combined.verifiedFields;paddleUsed=true;
    }
    verified.push(recognition.data.verifiedFields);
    // Keep digital text when OCR cannot read a sparse page; an unreadable scanned page blocks.
    if(recognition.data.text.trim()){
     const tokens=(s:string)=>s.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().match(/[a-z0-9]+/g)||[];
     const digital=new Set(tokens(text));
     const novel=tokens(recognition.data.text).filter(token=>!digital.has(token));
     // When OCR only repeats existing digital text, do not turn digital fields into OCR fields.
     if(!text.trim() || novel.length){usedOcr=true;text=text.trim()?text+'\n'+recognition.data.text:recognition.data.text;scores.push(recognition.data.confidence);}
    }
    else if(!text.trim())throw Error(`Página ${n}: nenhum texto legível encontrado. Confira a digitalização.`);
   }
   texts.push(text);page.cleanup();
   if(texts.join("\n").length>maxText)throw Error("PDF excede o limite de texto; separe em partes.");
   progress?.({...result(texts.join('\n\n'),usedOcr?'PDF com OCR':'Texto do PDF',usedOcr,scores.length?Math.min(...scores):undefined,document.numPages),needsReview:true,warnings:[`Leitura parcial: ${n} de ${document.numPages} páginas processadas.`]});
  }
  const reading=result(texts.join("\n\n"),usedOcr?"PDF com OCR":"Texto do PDF",usedOcr,scores.length?Math.min(...scores):undefined,document.numPages);
  const digitalText=digitalTexts.join('\n'),digitalFields=mergeExtractedFields(fieldsFromLines(digitalText.split(/\r?\n/).map(s=>s.trim()).filter(Boolean)),tableFields);
  for(const party of extractContractParties(digitalText))mergeExtractedFields(digitalFields,{cnpj:[party.cnpj],razaoSocial:[party.name]});
  return {...reading,fields:mergeExtractedFields(mergeExtractedFields(reading.fields,tableFields),ocrFields),tableFields,digitalFields,verifiedFields:document.numPages===1&&verified.length===1?verified[0]:[],ocrEngine:usedOcr?(paddleUsed?'Tesseract + PaddleOCR PP-OCRv5':'Tesseract'):undefined};
 }catch(e:any){if(e?.name==="PasswordException")throw Error("PDF protegido por senha. Envie uma cópia acessível para análise.");throw e;}
 finally{await worker?.terminate();await loading.destroy();}
}
/** Reuses native text only after checking every page; never returns a partial substitute. */
export async function readNativePdf(bytes:Buffer):Promise<Reading> {return pdf(bytes,undefined,true);}
/** This is evidence for individual digital fields, never proof that scanned regions were read. */
export async function readPdfDigitalLayer(bytes:Buffer):Promise<Reading> {return pdf(bytes,undefined,false,true);}
function xml(source:string) {
 if(/<!DOCTYPE|<!ENTITY/i.test(source))throw Error("XML com entidades não suportado.");
 return new DOMParser({onError:()=>{throw Error("XML inválido.");}}).parseFromString(source,"application/xml");
}
async function office(bytes:Buffer,name:string,progress?:(reading:Reading)=>void) {
 preflight(bytes);const zip=new PizZip(bytes),extension=extname(name).toLowerCase();
 for(const f of Object.values(zip.files))if(/vbaProject|embeddings|activeX/i.test(f.name))throw Error("Arquivo com conteúdo ativo requer conferência manual.");
 let text="",formulaCount=0;
 if(extension===".odt") {
  const entry=zip.file("content.xml");if(!entry)throw Error("ODT inválido.");
  const doc=xml(entry.asText());text=Array.from(doc.getElementsByTagNameNS("urn:oasis:names:tc:opendocument:xmlns:text:1.0","p")).map(p=>p.textContent||"").join("\n");
 }else if(extension===".pptx") {
  const slides=Object.values(zip.files).filter(f=>/^ppt\/slides\/slide\d+\.xml$/.test(f.name)).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
  if(!slides.length || slides.length>maxPages)throw Error("PPTX inválido ou acima de 30 slides.");
  text=slides.map(f=>Array.from(xml(f.asText()).getElementsByTagNameNS("http://schemas.openxmlformats.org/drawingml/2006/main","p")).map(p=>p.textContent||"").join("\n")).join("\n\n");
 }else {
  const shared=zip.file("xl/sharedStrings.xml"),strings=shared?Array.from(xml(shared.asText()).getElementsByTagName("si")).map(p=>p.textContent||""):[];
  const styleEntry=zip.file("xl/styles.xml"),styles=styleEntry?xml(styleEntry.asText()):null;
  const formats:Record<string,string>={'9':'0%','10':'0.00%'};
  for(const f of Array.from(styles?.getElementsByTagName('numFmt')||[]))formats[f.getAttribute('numFmtId')||'']=f.getAttribute('formatCode')||'';
  const cellStyles=Array.from(styles?.getElementsByTagName('cellXfs')[0]?.getElementsByTagName('xf')||[]);
  const sheets=Object.values(zip.files).filter(f=>/^xl\/worksheets\/sheet\d+\.xml$/.test(f.name));
  if(!sheets.length || sheets.length>30)throw Error("XLSX inválido ou acima de 30 planilhas.");
  text=sheets.map(f=>Array.from(xml(f.asText()).getElementsByTagName("row")).map(row=>Array.from(row.getElementsByTagName("c")).map(cell=>{
   if(cell.getElementsByTagName("f").length){formulaCount++;return "[DADO CALCULADO: conferir na planilha original]";}
   const value=cell.getElementsByTagName("v")[0]?.textContent||cell.getElementsByTagName("is")[0]?.textContent||"";
   if(cell.getAttribute('t')==='s')return strings[Number(value)]||'';
   const format=formats[cellStyles[Number(cell.getAttribute('s')||0)]?.getAttribute('numFmtId')||'']||'';
   if((!cell.getAttribute('t')||cell.getAttribute('t')==='n') && value && Number.isFinite(Number(value)) && /%/.test(format.replace(/"[^"]*"|\\./g,'')))return (Number(value)*100).toFixed(2).replace('.',',')+'%';
   return value;
  }).filter((value,index,values)=>!!value && (value!=="[DADO CALCULADO: conferir na planilha original]" || values.indexOf(value)===index)).join(": ")).filter(Boolean).join("\n")).join("\n\n");
 }
 // Office containers can have image-only or hidden areas that plain text extraction misses.
 const incomplete=text.length>maxText;
 if(incomplete)text=text.slice(0,maxText).replace(/\n[^\n]*$/,'');
 const native={...result(text,extension.slice(1).toUpperCase()),needsReview:!!text.trim(),incomplete,warnings:[...(incomplete?['Leitura parcial: o documento excedeu o limite de texto. O trecho já lido foi preservado; envie o restante em partes para concluir a conferência.']:[]),...(formulaCount?[`${formulaCount} célula(s) com fórmulas foram omitidas da extração. As fórmulas não foram executadas e seus resultados salvos não foram usados. Confira a planilha original; para analisar os resultados, envie uma cópia com valores conferidos.`]:[])],formulaCount};
 const embedded=Object.values(zip.files).filter(f=>/^(?:Pictures|ppt\/media|xl\/media)\/.+\.(png|jpe?g|webp|bmp|tiff?)$/i.test(f.name));
 if(embedded.length>30)throw Error('Arquivo contém mais de 30 imagens. Divida o documento.');
 const digitalFields=structuredClone(native.fields);let usedOcr=false;
 for(const entry of embedded){
  const data=entry.asNodeBuffer(),meta=await sharp(await prepareImage(data),{limitInputPixels:24000000}).metadata();
  if(!meta.width||!meta.height||meta.width*meta.height<60000||meta.height<100||meta.width<150)continue;
  progress?.({...native,digitalFields,needsReview:true,incomplete:true});
  const read=await image(data,entry.name);usedOcr=true;
  if(read.problem){native.incomplete=true;native.warnings.push('Imagem incorporada não pôde ser lida: '+entry.name);}
  else{mergeExtractedFields(native.fields,read.fields);native.text+='\n\nIMAGEM INCORPORADA: '+entry.name+'\n'+read.text;native.problem='';}
  if(native.text.length>maxText)throw Error('Arquivo excede o limite de texto. Divida o documento.');
 }
 return {...native,digitalFields,needsReview:native.needsReview||usedOcr,method:native.method+(usedOcr?' com OCR':'')};
}
export async function readDocumentRegion(bytes:Buffer,name:string,region:ReadingRegion):Promise<Reading> {
 if(!validReadingRegion(region)||bytes.length>20*1024*1024)throw Error('Região inválida ou arquivo maior que 20 MB.');
 let png:Buffer;
 if(/\.pdf$/i.test(name)) {
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const root=dirname(require.resolve('pdfjs-dist/package.json'));
  const loading=getDocument({data:new Uint8Array(bytes),useSystemFonts:false,standardFontDataUrl:join(root,'standard_fonts')+'/',cMapUrl:join(root,'cmaps')+'/',cMapPacked:true,wasmUrl:join(root,'wasm')+'/',verbosity:0});
  try {
   const document=await loading.promise;
   if(document.numPages>30||region.page>document.numPages)throw Error('Página indisponível. Use um PDF com até 30 páginas.');
   const page=await document.getPage(region.page),base=page.getViewport({scale:1});
   const viewport=page.getViewport({scale:Math.min(3,3200/Math.max(base.width,base.height))});
   const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
   await page.render({canvas:canvas as any,canvasContext:canvas.getContext('2d') as any,viewport}).promise;
   png=canvas.toBuffer('image/png');
  } finally {await loading.destroy();}
 } else {
  if(!/\.(png|jpe?g|webp|tiff?|bmp|gif)$/i.test(name))throw Error('Selecione um PDF ou imagem.');
  png=await sharp(await prepareImage(bytes),{limitInputPixels:24000000,page:region.page-1,pages:1}).rotate().flatten({background:'#fff'}).png().toBuffer();
 }
 const metadata=await sharp(png).metadata(),width=metadata.width!,height=metadata.height!;
 const left=Math.floor(region.x*width),top=Math.floor(region.y*height);
 const cropped=await sharp(png).extract({left,top,width:Math.min(width-left,Math.max(1,Math.round(region.width*width))),height:Math.min(height-top,Math.max(1,Math.round(region.height*height)))}).rotate(region.rotation).resize({width:2400,height:2400,fit:'inside'}).png().toBuffer();
 const reading=await image(cropped);
 return {...reading,needsReview:true,method:'OCR de região',warnings:[`Trecho da página ${region.page}. Resultado auxiliar: confira no original antes de corrigir qualquer campo.`]};
}
export async function readDocument(bytes:Buffer,name:string,progress?:(reading:Reading)=>void):Promise<Reading> {
 const extension=extname(name).toLowerCase();
 if(extension==='.docx'){
  const native=extractProcessingFile(bytes,name);
  if(native.problem)return {...native,version:readerVersion,method:'DOCX',needsReview:false};
  const zip=new PizZip(bytes),images=Object.values(zip.files).filter(f=>/^word\/media\/.+\.(png|jpe?g|webp|bmp|tiff?)$/i.test(f.name));
  const digitalFields=structuredClone(native.fields),fields=structuredClone(native.fields),texts=[native.text],warnings:string[]=[];
  if(images.length>30)throw Error('Word contém mais de 30 imagens. Divida o documento para leitura completa.');
  let usedOcr=false,incomplete=false;
  for(const entry of images){
   const data=entry.asNodeBuffer(),meta=await sharp(await prepareImage(data),{limitInputPixels:24000000}).metadata();
   if(!meta.width||!meta.height)continue;
   if(meta.width*meta.height<60000||meta.height<100||meta.width<150)continue;
   usedOcr=true;
   const reading=await image(data,entry.name);
   if(reading.problem){incomplete=true;warnings.push('Imagem incorporada não pôde ser lida: '+entry.name);}
   else{mergeExtractedFields(fields,reading.fields);texts.push('IMAGEM INCORPORADA: '+entry.name+'\n'+reading.text);}
   if(texts.join('\n').length>maxText)throw Error('Word excede o limite de texto. Divida o arquivo.');
   progress?.({...native,version:readerVersion,fields,text:texts.join('\n\n'),digitalFields,needsReview:true,incomplete:true,method:'DOCX com OCR'});
  }
  return {...native,version:readerVersion,fields,text:texts.join('\n\n'),digitalFields,needsReview:usedOcr,incomplete,warnings,method:usedOcr?'DOCX com OCR':'DOCX'};
 }
 if(extension===".pdf") {
  if(bytes.subarray(0,5).toString()!=="%PDF-")throw Error("O conteúdo recebido não corresponde a um PDF válido.");
  return pdf(bytes,progress);
 }
 if(/\.(png|jpe?g|webp|tiff?|bmp|gif)$/i.test(extension))return image(bytes,name);
 if([".odt",".xlsx",".pptx"].includes(extension))return office(bytes,name,progress);
 if(extension===".doc") {
  if(bytes.subarray(0,8).toString("hex")!=="d0cf11e0a1b11ae1")throw Error("Arquivo DOC antigo inválido. Não basta renomear a extensão.");
  const WordExtractor=require("word-extractor"),doc=await new WordExtractor().extract(bytes);
  const text=[doc.getBody(),doc.getHeaders(),doc.getFootnotes(),doc.getEndnotes()].filter(Boolean).join("\n");
  return {...result(text,"Word DOC"),needsReview:!!text.trim()};
 }
 throw Error("Formato sem leitor disponível.");
}
