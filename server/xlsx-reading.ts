import type PizZip from "pizzip";
import { DOMParser } from "@xmldom/xmldom";
import { fieldsFromLines,fieldsFromRows,fieldKeyForLabel,mergeExtractedFields,norm } from "./processing-extract.js";
export const formulaPlaceholder="[DADO CALCULADO: conferir na planilha original]";
type Cell={column:number;value:string;calculated?:string};
type Sheet={name:string;hidden:boolean;rows:Cell[][]};
function xml(source:string) {
 if(/<!DOCTYPE|<!ENTITY/i.test(source))throw Error("XML com entidades não suportado.");
 return new DOMParser({onError:()=>{throw Error("XML inválido.");}}).parseFromString(source,"application/xml");
}
const columnNumber=(reference:string)=>[...(/^[A-Z]+/.exec(reference)?.[0]||"")].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
/** Workbook order and names; files named sheetN.xml do not follow the visible tab order. */
function sheetEntries(zip:PizZip) {
 const workbook=zip.file("xl/workbook.xml"),rels=zip.file("xl/_rels/workbook.xml.rels");
 if(workbook&&rels){
  const doc=xml(workbook.asText()),targets:Record<string,string>={};
  for(const rel of Array.from(xml(rels.asText()).getElementsByTagName("Relationship")))targets[rel.getAttribute("Id")||""]=rel.getAttribute("Target")||"";
  const date1904=/^(1|true)$/i.test(doc.getElementsByTagName("workbookPr")[0]?.getAttribute("date1904")||"");
  const sheets=Array.from(doc.getElementsByTagName("sheet")).map(sheet=>{
   const target=targets[sheet.getAttribute("r:id")||""]||"";
   const path=target.startsWith("/")?target.slice(1):("xl/"+target).replace(/[^/]+\/\.\.\//g,"");
   return {name:sheet.getAttribute("name")||"",hidden:/hidden/i.test(sheet.getAttribute("state")||""),entry:/^xl\/worksheets\/[^/]+\.xml$/.test(path)?zip.file(path):null};
  }).filter(sheet=>sheet.entry);
  if(sheets.length)return {date1904,sheets};
 }
 const files=Object.values(zip.files).filter(f=>/^xl\/worksheets\/sheet\d+\.xml$/.test(f.name)).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
 return {date1904:false,sheets:files.map((entry,index)=>({name:"Planilha "+(index+1),hidden:false,entry}))};
}
function numberFormats(zip:PizZip) {
 const entry=zip.file("xl/styles.xml"),styles=entry?xml(entry.asText()):null;
 const formats:Record<string,string>={"9":"0%","10":"0.00%","2":"0.00","4":"#,##0.00","14":"dd/mm/yyyy","15":"d-mmm-yy","16":"d-mmm","17":"mmm-yy","22":"dd/mm/yyyy hh:mm"};
 for(const f of Array.from(styles?.getElementsByTagName("numFmt")||[]))formats[f.getAttribute("numFmtId")||""]=f.getAttribute("formatCode")||"";
 const cellStyles=Array.from(styles?.getElementsByTagName("cellXfs")[0]?.getElementsByTagName("xf")||[]);
 return (style:string|null)=>formats[cellStyles[Number(style||0)]?.getAttribute("numFmtId")||""]||"";
}
/** Applies the cell's number format; percentages, dates and fixed decimals follow the Brazilian notation used elsewhere. */
function formatted(value:string,format:string,date1904:boolean) {
 const number=Number(value);
 if(!value||!Number.isFinite(number))return value;
 const code=format.split(";")[0].replace(/"[^"]*"|\\.|\[[^\]]*\]/g,"");
 if(/%/.test(code))return (number*100).toFixed(2).replace(".",",")+"%";
 if(/[dy]/i.test(code)&&number>=1&&number<2958466){
  const date=new Date(Math.round((Math.floor(number)+(date1904?1462:0)-25569)*86400000));
  return [date.getUTCDate(),date.getUTCMonth()+1].map(n=>String(n).padStart(2,"0")).join("/")+"/"+date.getUTCFullYear();
 }
 const decimals=/0\.(0+)/.exec(code)?.[1].length;
 return decimals?number.toFixed(decimals).replace(".",","):value;
}
function readSheets(zip:PizZip) {
 const shared=zip.file("xl/sharedStrings.xml");
 // Phonetic runs (rPh) are reading aids, not cell content.
 const strings=shared?Array.from(xml(shared.asText()).getElementsByTagName("si")).map(si=>Array.from(si.getElementsByTagName("t")).filter(t=>(t.parentNode as any)?.localName!=="rPh").map(t=>t.textContent||"").join("")):[];
 const formatOf=numberFormats(zip),{date1904,sheets}=sheetEntries(zip);
 if(!sheets.length||sheets.length>30)throw Error("XLSX inválido ou acima de 30 planilhas.");
 let formulaCount=0;
 const result:Sheet[]=sheets.map(sheet=>({name:sheet.name,hidden:sheet.hidden,rows:Array.from(xml(sheet.entry!.asText()).getElementsByTagName("row")).map(row=>{
  let next=1;
  return Array.from(row.getElementsByTagName("c")).map(cell=>{
   const column=columnNumber(cell.getAttribute("r")||"")||next;next=column+1;
   const type=cell.getAttribute("t"),raw=cell.getElementsByTagName("v")[0]?.textContent||"";
   const value=type==="s"?strings[Number(raw)]||"":type==="inlineStr"?cell.getElementsByTagName("is")[0]?.textContent||"":type==="b"?(raw==="1"?"VERDADEIRO":raw==="0"?"FALSO":""):type==="e"?"":type==="str"?raw:formatted(raw,formatOf(cell.getAttribute("s")),date1904);
   if(cell.getElementsByTagName("f").length){formulaCount++;return {column,value:formulaPlaceholder,calculated:value.trim()};}
   return {column,value:value.trim()};
  }).filter(cell=>cell.value||cell.calculated);
 })}));
 return {sheets:result,formulaCount};
}
const numericKeys=["cnpj","cep","alunos","remuneracao","garantia","repasse","repasseSegundo","cashback","valor","cashbackValor","parcelas","inicio","fim","dataFormalizacao","dataAssinaturaMatriz","representanteCpf","documentoTitular","agencia","conta","numero"];
/** Table headers sit next to each other ("Taxa | Parcela Antecipação"); a numeric field needs a digit. */
function plausible(fields:Record<string,string[]>) {
 return Object.fromEntries(Object.entries(fields).map(([key,values])=>[key,numericKeys.includes(key)?values.filter(value=>/\d/.test(value)):values]).filter(([,values])=>values.length));
}
/** Label/value pairs in a row, header rows aligned by column, and the previous line-based reading for anything else. */
function sheetFields(rows:string[][],columns:number[][]) {
 const fields:Record<string,string[]>={},lines:string[]=[];
 for(let i=0;i<rows.length;i++){
  const row=rows[i],below=rows[i+1];
  if(row.length>1&&below&&row.every(cell=>!!fieldKeyForLabel(cell))&&!below.some(cell=>!!fieldKeyForLabel(cell))){
   const pairs=row.map((label,n)=>[label,below[columns[i+1].indexOf(columns[i][n])]]).filter(([,value])=>value!==undefined);
   if(pairs.length){mergeExtractedFields(fields,fieldsFromRows([pairs.map(p=>p[0]),pairs.map(p=>p[1])]));i++;continue;}
  }
  const paired=row.length>1?fieldsFromRows([row]):{};
  if(Object.keys(paired).length)mergeExtractedFields(fields,paired);
  else lines.push(row.join(": "));
 }
 return plausible(mergeExtractedFields(fields,fieldsFromLines(lines)));
}
/** Saved formula results are kept apart: shown for conference, never adopted as fields. */
export function readSpreadsheet(zip:PizZip) {
 const {sheets,formulaCount}=readSheets(zip);
 const fields:Record<string,string[]>={},calculated:Record<string,string[]>={};
 const text=sheets.map(sheet=>{
  const lines=sheet.rows.map(row=>row.map(cell=>cell.value).filter((value,index,values)=>value!==formulaPlaceholder||values.indexOf(value)===index).join(": ")).filter(Boolean);
  if(!sheet.hidden){
   const columns=sheet.rows.map(row=>row.map(cell=>cell.column));
   mergeExtractedFields(fields,sheetFields(sheet.rows.map(row=>row.map(cell=>cell.value)),columns));
   if(sheet.rows.some(row=>row.some(cell=>cell.calculated)))mergeExtractedFields(calculated,sheetFields(sheet.rows.map(row=>row.map(cell=>cell.calculated??cell.value)),columns));
  }
  return lines.length?`PLANILHA: ${sheet.name}${sheet.hidden?" (oculta)":""}\n`+lines.join("\n"):"";
 }).filter(Boolean).join("\n\n");
 const calculatedFields=Object.fromEntries(Object.entries(calculated).map(([key,values])=>[key,values.filter(value=>!(fields[key]||[]).some(v=>norm(v)===norm(value)))]).filter(([,values])=>values.length));
 return {text,fields,calculatedFields,formulaCount,hiddenSheets:sheets.filter(sheet=>sheet.hidden&&sheet.rows.length).map(sheet=>sheet.name)};
}
