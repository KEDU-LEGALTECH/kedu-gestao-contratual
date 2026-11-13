import {test} from "node:test";
import assert from "node:assert/strict";
import PizZip from "pizzip";
import sharp from "sharp";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { sqliteSql } from "../server/sql.js";
import {readProcessingFile} from "../server/file-reading.js";
import {fieldsFromLines,normalizeValue} from "../server/processing-extract.js";
import {readingImage,readingPdf,mixedReadingPdf} from "./reading-fixtures.js";
import {demoTemplate} from '../server/documents.js';

test('Word mantém texto digital e lê imagens incorporadas sem substituir o original',async()=>{
 const zip=new PizZip(demoTemplate());
 zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Razão social: Empresa teste</w:t></w:r></w:p></w:body></w:document>');
 zip.file('word/media/documento.png',readingImage().toBuffer('image/png'));
 const bytes=zip.generate({type:'nodebuffer'}),original=Buffer.from(bytes);
 const result=await readProcessingFile(bytes,'arquivo.docx');
 assert.equal(result.problem,'');assert.equal(result.method,'DOCX com OCR');
 assert.deepEqual(result.fields.razaoSocial,['Empresa teste']);assert.deepEqual(result.fields.cnpj,['11.444.777/0001-61']);
 assert.equal(result.digitalFields?.cnpj,undefined);assert.deepEqual(bytes,original);
});
test('Word contendo somente uma digitalização também passa por OCR',async()=>{
 const zip=new PizZip(demoTemplate());
 zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>');
 zip.file('word/media/documento.png',readingImage().toBuffer('image/png'));
 const reading=await readProcessingFile(zip.generate({type:'nodebuffer'}),'digitalizacao.docx');
 assert.equal(reading.problem,'');assert.equal(reading.method,'DOCX com OCR');assert.ok(reading.fields.cnpj?.includes('11.444.777/0001-61'));
});

test("PDF digital extrai texto e campos sem exigir conversão para DOCX",async()=>{
 const r=await readProcessingFile(readingPdf(),"contrato.pdf");assert.equal(r.problem,"");assert.equal(r.method,"Texto do PDF");assert.equal(r.needsReview,false);assert.deepEqual(r.fields.remuneracao,["11,84%"]);
});
test('PDF misto publica campos de todas as páginas digitais antes do OCR da primeira página',async()=>{
 const {readDocument}=await import('../server/file-reading-engine.js');
 const progress:any[]=[];
 const reading=await readDocument(mixedReadingPdf(),'misto.pdf',r=>progress.push(r));
 const native=progress.find(r=>r.warnings?.some((w:string)=>w.includes('Camada digital: 2 de 2')));
 assert.ok(native);assert.deepEqual(native.digitalFields.cnpj,['00.817.900/0001-26']);
 assert.deepEqual(native.digitalFields.valor,['2000,00']);assert.equal(native.incomplete,true);
 assert.ok(reading.fields.cnpj.includes('00.817.900/0001-26'));assert.equal(reading.pages,2);
});
test("OCR de PNG, JPEG, WebP e TIFF reconhece dados e exige conferência",async()=>{
 for(const extension of ["png","jpeg","webp","tiff","gif"] as const){const bytes=await sharp(readingImage().toBuffer("image/png")).toFormat(extension).toBuffer();const r=await readProcessingFile(bytes,"contrato."+extension);assert.equal(r.problem,"",extension+JSON.stringify(r));assert.equal(r.needsReview,true);assert.ok(r.fields.cnpj?.includes("11.444.777/0001-61"),JSON.stringify(r));assert.ok(r.fields.remuneracao?.includes("11,84%"),JSON.stringify(r));}
});
test("PDF digitalizado passa por OCR e mantém leitura sujeita a conferência",async()=>{
 const r=await readProcessingFile(readingPdf(true),"digitalizado.pdf");assert.equal(r.problem,"",JSON.stringify(r));assert.equal(r.method,"PDF com OCR");assert.equal(r.needsReview,true);assert.ok(r.fields.remuneracao?.includes("11,84%"),JSON.stringify(r));
});
test("PDF digitalizado reutiliza páginas persistidas preservando os campos", async () => {
 const db=new DatabaseSync(":memory:");
 try {
  db.exec(readFileSync("migrations/020.sql","utf8"));
  const sql=sqliteSql(db);
  const bytes=readingPdf(true,2);
  const fileName="contrato-digitalizado.pdf";
  const first=await readProcessingFile(bytes,fileName,undefined,false,{pageStore:sql});
  assert.deepEqual(first.completedPages,[1,2]);
  const page=await sql.one("SELECT reading FROM reading_pages WHERE page=1");
  assert.ok(page);
  await sql.run("DELETE FROM reading_pages WHERE page=2");
  const saved:number[]=[];
  const pageStore={...sql,run(query:string,...params:unknown[]){
   if(query.startsWith("INSERT"))saved.push(Number(params[2]));
   return sql.run(query,...params);
  }};
  const resumed=await readProcessingFile(bytes,fileName,undefined,false,{pageStore});
  assert.deepEqual(saved,[2]);
  assert.deepEqual(resumed.completedPages,[1,2]);
  assert.deepEqual(resumed.fields,first.fields);
  assert.deepEqual(resumed.fieldOrigins,first.fieldOrigins);
 } finally { db.close(); }
});
test("Arquivo vazio, falso PDF, formato desconhecido e imagem em branco não passam como corretos",async()=>{
 for(const [bytes,name] of [[Buffer.alloc(0),"vazio.pdf"],[Buffer.from("<html>erro</html>"),"falso.pdf"],[Buffer.from("teste"),"programa.exe"],[readingImage(true).toBuffer("image/png"),"branco.png"]] as const){const r=await readProcessingFile(bytes,name);assert.ok(r.problem,name);assert.equal(r.needsReview,false);}
});
test("TXT, CSV e ODT entram nas mesmas regras de extração",async()=>{
 for(const name of ["dados.txt","dados.csv"]){const r=await readProcessingFile(Buffer.from("CNPJ: 11.444.777/0001-61\nTaxa de remuneracao: 11,84%"),name);assert.equal(r.problem,"");assert.deepEqual(r.fields.remuneracao,["11,84%"]);}
 const zip=new PizZip();zip.file("content.xml",'<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><text:p>Taxa de remuneracao: 11,84%</text:p></office:document>');
 const r=await readProcessingFile(zip.generate({type:"nodebuffer"}),"dados.odt");assert.equal(r.problem,"");assert.deepEqual(r.fields.remuneracao,["11,84%"]);assert.equal(r.needsReview,true);
});
test("Extrator não confunde rótulo seguinte com CEP e normaliza CEP pontuado",()=>{
 assert.equal(fieldsFromLines(["CEP:","DATA DE NASCIMENTO:","01/01/2000"]).cep,undefined);assert.equal(normalizeValue("cep","43.815-360"),"43815-360");
});

test("XLSX e PPTX fornecem campos para validação com conferência obrigatória",async()=>{
 const xlsx=new PizZip();xlsx.file("xl/worksheets/sheet1.xml",'<worksheet><sheetData><row><c t="inlineStr"><is><t>Taxa de remuneracao</t></is></c><c t="inlineStr"><is><t>11,84%</t></is></c></row></sheetData></worksheet>');
 const pptx=new PizZip();pptx.file("ppt/slides/slide1.xml",'<p:sld xmlns:p="urn:p" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:p><a:r><a:t>Taxa de remuneracao: 11,84%</a:t></a:r></a:p></p:sld>');
 for(const [zip,name] of [[xlsx,"dados.xlsx"],[pptx,"dados.pptx"]] as const){const r=await readProcessingFile(zip.generate({type:"nodebuffer"}),name);assert.equal(r.problem,"");assert.deepEqual(r.fields.remuneracao,["11,84%"]);assert.equal(r.needsReview,true);}
 xlsx.file("xl/worksheets/sheet1.xml",'<worksheet><row><c><f>1+2</f><v>3</v></c></row></worksheet>');
  const formula=await readProcessingFile(xlsx.generate({type:"nodebuffer"}),"formula.xlsx");
  assert.equal(formula.problem,"");assert.equal(formula.formulaCount,1);assert.equal(formula.needsReview,true);assert.match(formula.warnings!.join(' '),/fórmulas/);assert.deepEqual(formula.fields,{});assert.doesNotMatch(formula.text,/\b1\+2\b/);
});

test('XLSX com fórmulas preserva literais e percentuais formatados sem confiar no resultado calculado',async()=>{
 const zip=new PizZip();
 zip.file('xl/styles.xml','<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="10"/></cellXfs></styleSheet>');
 zip.file('xl/worksheets/sheet1.xml','<worksheet><sheetData><row><c t="inlineStr"><is><t>Remuneração Kedu</t></is></c><c s="1"><v>0.0437</v></c></row><row><c t="inlineStr"><is><t>Quantidade de parcelas</t></is></c><c><v>24</v></c></row><row><c t="inlineStr"><is><t>Valor de referência</t></is></c><c><f>SUM(A1:A4)</f><v>999999</v></c></row></sheetData></worksheet>');
 const r=await readProcessingFile(zip.generate({type:'nodebuffer'}),'parcial.xlsx');
 assert.equal(r.problem,'');assert.deepEqual(r.fields.remuneracao,['4,37%']);assert.deepEqual(r.fields.parcelas,['24']);assert.equal(r.fields.valor,undefined);
 assert.equal(r.formulaCount,1);assert.equal(r.needsReview,true);assert.doesNotMatch(r.text,/999999|SUM\(/);
});

test('XLSX segue a ordem das abas, alinha cabeçalhos por coluna e separa resultados de fórmulas',async()=>{
 const zip=new PizZip();
 zip.file('xl/workbook.xml','<workbook xmlns:r="urn:r"><workbookPr/><sheets><sheet name="Escolas" sheetId="1" state="hidden" r:id="rId1"/><sheet name="Proposta" sheetId="2" r:id="rId2"/></sheets></workbook>');
 zip.file('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>');
 zip.file('xl/styles.xml','<styleSheet><numFmts><numFmt numFmtId="164" formatCode="&quot;R$&quot;\\ #,##0.00"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs></styleSheet>');
 zip.file('xl/worksheets/sheet1.xml','<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>CNPJ</t></is></c><c r="B1" t="inlineStr"><is><t>99.999.999/0001-91</t></is></c></row></sheetData></worksheet>');
 zip.file('xl/worksheets/sheet2.xml','<worksheet><sheetData>'+
  '<row r="1"><c r="A1" t="inlineStr"><is><t>Quantidade de parcelas</t></is></c><c r="C1" t="inlineStr"><is><t>Data de início</t></is></c></row>'+
  '<row r="2"><c r="A2"><v>12</v></c><c r="C2" s="1"><v>46023</v></c></row>'+
  '<row r="4"><c r="A4" t="inlineStr"><is><t>Valor de referência</t></is></c><c r="B4" s="2"><f>B5*12</f><v>91721.15</v></c></row>'+
  '</sheetData></worksheet>');
 const r=await readProcessingFile(zip.generate({type:'nodebuffer'}),'proposta.xlsx');
 assert.equal(r.problem,'');
 assert.deepEqual(r.fields.parcelas,['12']);assert.deepEqual(r.fields.inicio,['2026-01-01']);
 assert.equal(r.fields.cnpj,undefined,'aba oculta não fornece campos');
 assert.equal(r.fields.valor,undefined);assert.deepEqual(r.calculatedFields?.valor,['91721,15']);
 assert.doesNotMatch(r.text,/91721/);assert.match(r.text,/PLANILHA: Escolas \(oculta\)[\s\S]*PLANILHA: Proposta/);
 assert.match(r.warnings!.join(' '),/oculta.*Escolas/);assert.equal(r.formulaCount,1);
});

test("BMP passa por normalização local e DOC inválido não é aprovado",async()=>{
 const {data,info}=await sharp(readingImage().toBuffer("image/png")).removeAlpha().raw().toBuffer({resolveWithObject:true});
 const stride=Math.ceil(info.width*3/4)*4,bmp=Buffer.alloc(54+stride*info.height);bmp.write("BM");bmp.writeUInt32LE(bmp.length,2);bmp.writeUInt32LE(54,10);bmp.writeUInt32LE(40,14);bmp.writeInt32LE(info.width,18);bmp.writeInt32LE(info.height,22);bmp.writeUInt16LE(1,26);bmp.writeUInt16LE(24,28);
 for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){const input=(y*info.width+x)*3,output=54+(info.height-1-y)*stride+x*3;bmp[output]=data[input+2];bmp[output+1]=data[input+1];bmp[output+2]=data[input];}
 const r=await readProcessingFile(bmp,"imagem.bmp");assert.equal(r.problem,"");assert.equal(r.needsReview,true);assert.ok(r.fields.remuneracao?.includes("11,84%"));
 assert.ok((await readProcessingFile(Buffer.from("arquivo inválido"),"falso.doc")).problem);
});
