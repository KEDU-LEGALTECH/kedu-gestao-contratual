import { createRequire } from "node:module";
import { dirname,join,extname } from "node:path";
import PizZip from "pizzip";
import { DOMParser } from "@xmldom/xmldom";
import sharp from "sharp";
import { createWorker } from "tesseract.js";
import { createCanvas } from "@napi-rs/canvas";
import { fieldsFromLines } from "./processing-extract.js";
import { preflight } from "./documents.js";
import { readerVersion,type Reading } from "./file-reading.js";
import { prepareImage } from "./image-input.js";
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
async function image(bytes:Buffer) {
 bytes=await prepareImage(bytes);
 const source=sharp(bytes,{limitInputPixels:24000000,failOn:"error"}),meta=await source.metadata();
 if(!meta.width || !meta.height)throw Error("Imagem inválida.");
 const count=meta.pages||1;if(count>maxPages)throw Error("Imagem contém mais de 30 páginas ou quadros; separe o arquivo.");
 const worker=await ocrSession();const texts:string[]=[],scores:number[]=[];
 try {
  for(let page=0;page<count;page++) {
   const png=await sharp(bytes,{page,pages:1,limitInputPixels:24000000}).rotate().flatten({background:"white"}).resize({width:2200,height:3000,fit:"inside",withoutEnlargement:false}).png().toBuffer();
   const {data}=await worker.recognize(png);texts.push(data.text);scores.push(data.confidence);
  }
 }finally{await worker.terminate();}
 return result(texts.join("\n\n"),"OCR de imagem",true,Math.min(...scores),count);
}
async function pdf(bytes:Buffer) {
 const {getDocument}=await import("pdfjs-dist/legacy/build/pdf.mjs");
 const root=dirname(require.resolve("pdfjs-dist/package.json"));
 const loading=getDocument({data:new Uint8Array(bytes),useSystemFonts:false,standardFontDataUrl:join(root,"standard_fonts")+"/",cMapUrl:join(root,"cmaps")+"/",cMapPacked:true,wasmUrl:join(root,"wasm")+"/",verbosity:0});
 let document:any,worker:Awaited<ReturnType<typeof ocrSession>>|undefined;
 try {
  document=await loading.promise;
  if(document.numPages>maxPages)throw Error("PDF contém mais de 30 páginas. Separe o arquivo; nenhuma página foi ignorada na aprovação.");
  const texts:string[]=[],scores:number[]=[];let usedOcr=false;
  for(let n=1;n<=document.numPages;n++) {
   const page=await document.getPage(n),content=await page.getTextContent();
   let text="";
   for(const item of content.items as any[])if(typeof item.str==="string")text+=item.str+(item.hasEOL?"\n":" ");
   // A page with sparse text may contain a scanned body below a digital header.
   const operators=await page.getOperatorList();
   const {OPS}=await import("pdfjs-dist/legacy/build/pdf.mjs");
   const hasImage=operators.fnArray.some((op:number)=>[OPS.paintImageXObject,OPS.paintInlineImageXObject,OPS.paintImageXObjectRepeat].includes(op));
   if(hasImage || text.trim().length<40) {
    worker??=await ocrSession();usedOcr=true;
    const base=page.getViewport({scale:1});
    const scale=Math.min(2.5,3200/Math.max(base.width,base.height));
    if(!Number.isFinite(scale) || scale<=0)throw Error("Dimensão de página inválida.");
    const viewport=page.getViewport({scale});
    const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
    await page.render({canvas:canvas as any,canvasContext:canvas.getContext("2d") as any,viewport}).promise;
    const recognition=await worker.recognize(canvas.toBuffer("image/png"));
    // Keep digital text when OCR cannot read a sparse page; an unreadable scanned page blocks.
    if(recognition.data.text.trim())text=text.trim()?text+"\n"+recognition.data.text:recognition.data.text;
    else if(!text.trim())throw Error(`Página ${n}: nenhum texto legível encontrado. Confira a digitalização.`);
    scores.push(recognition.data.confidence);
   }
   texts.push(text);page.cleanup();
   if(texts.join("\n").length>maxText)throw Error("PDF excede o limite de texto; separe em partes.");
  }
  return result(texts.join("\n\n"),usedOcr?"PDF com OCR":"Texto do PDF",usedOcr,scores.length?Math.min(...scores):undefined,document.numPages);
 }catch(e:any){if(e?.name==="PasswordException")throw Error("PDF protegido por senha. Envie uma cópia acessível para análise.");throw e;}
 finally{await worker?.terminate();await loading.destroy();}
}
function xml(source:string) {
 if(/<!DOCTYPE|<!ENTITY/i.test(source))throw Error("XML com entidades não suportado.");
 return new DOMParser({onError:()=>{throw Error("XML inválido.");}}).parseFromString(source,"application/xml");
}
function office(bytes:Buffer,name:string) {
 preflight(bytes);const zip=new PizZip(bytes),extension=extname(name).toLowerCase();
 for(const f of Object.values(zip.files))if(/vbaProject|embeddings|activeX/i.test(f.name))throw Error("Arquivo com conteúdo ativo requer conferência manual.");
 let text="";
 if(extension===".odt") {
  const entry=zip.file("content.xml");if(!entry)throw Error("ODT inválido.");
  const doc=xml(entry.asText());text=Array.from(doc.getElementsByTagNameNS("urn:oasis:names:tc:opendocument:xmlns:text:1.0","p")).map(p=>p.textContent||"").join("\n");
 }else if(extension===".pptx") {
  const slides=Object.values(zip.files).filter(f=>/^ppt\/slides\/slide\d+\.xml$/.test(f.name)).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
  if(!slides.length || slides.length>maxPages)throw Error("PPTX inválido ou acima de 30 slides.");
  text=slides.map(f=>Array.from(xml(f.asText()).getElementsByTagNameNS("http://schemas.openxmlformats.org/drawingml/2006/main","p")).map(p=>p.textContent||"").join("\n")).join("\n\n");
 }else {
  const shared=zip.file("xl/sharedStrings.xml"),strings=shared?Array.from(xml(shared.asText()).getElementsByTagName("si")).map(p=>p.textContent||""):[];
  const sheets=Object.values(zip.files).filter(f=>/^xl\/worksheets\/sheet\d+\.xml$/.test(f.name));
  if(!sheets.length || sheets.length>30)throw Error("XLSX inválido ou acima de 30 planilhas.");
  text=sheets.map(f=>Array.from(xml(f.asText()).getElementsByTagName("row")).map(row=>Array.from(row.getElementsByTagName("c")).map(cell=>{
   if(cell.getElementsByTagName("f").length)throw Error("Planilha contém fórmulas. Exporte os valores conferidos para análise.");
   const value=cell.getElementsByTagName("v")[0]?.textContent||cell.getElementsByTagName("is")[0]?.textContent||"";
   return cell.getAttribute("t")==="s"?strings[Number(value)]||"":value;
  }).filter(Boolean).join(": ")).join("\n")).join("\n\n");
 }
 // Office containers can have image-only or hidden areas that plain text extraction misses.
 return {...result(text,extension.slice(1).toUpperCase()),needsReview:!!text.trim()};
}
export async function readDocument(bytes:Buffer,name:string):Promise<Reading> {
 const extension=extname(name).toLowerCase();
 if(extension===".pdf") {
  if(bytes.subarray(0,5).toString()!=="%PDF-")throw Error("O conteúdo recebido não corresponde a um PDF válido.");
  return pdf(bytes);
 }
 if(/\.(png|jpe?g|webp|tiff?|bmp|gif)$/i.test(extension))return image(bytes);
 if([".odt",".xlsx",".pptx"].includes(extension))return office(bytes,name);
 if(extension===".doc") {
  if(bytes.subarray(0,8).toString("hex")!=="d0cf11e0a1b11ae1")throw Error("Arquivo DOC antigo inválido. Não basta renomear a extensão.");
  const WordExtractor=require("word-extractor"),doc=await new WordExtractor().extract(bytes);
  const text=[doc.getBody(),doc.getHeaders(),doc.getFootnotes(),doc.getEndnotes()].filter(Boolean).join("\n");
  return {...result(text,"Word DOC"),needsReview:!!text.trim()};
 }
 throw Error("Formato sem leitor disponível.");
}
