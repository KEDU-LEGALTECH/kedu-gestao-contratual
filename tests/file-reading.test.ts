import {test} from "node:test";
import assert from "node:assert/strict";
import PizZip from "pizzip";
import sharp from "sharp";
import {readProcessingFile} from "../server/file-reading.js";
import {fieldsFromLines,normalizeValue} from "../server/processing-extract.js";
import {readingImage,readingPdf} from "./reading-fixtures.js";
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

test("PDF digital extrai texto e campos sem exigir conversão para DOCX",async()=>{
 const r=await readProcessingFile(readingPdf(),"contrato.pdf");assert.equal(r.problem,"");assert.equal(r.method,"Texto do PDF");assert.equal(r.needsReview,false);assert.deepEqual(r.fields.remuneracao,["11,84%"]);
});
test("OCR de PNG, JPEG, WebP e TIFF reconhece dados e exige conferência",async()=>{
 for(const extension of ["png","jpeg","webp","tiff","gif"] as const){const bytes=await sharp(readingImage().toBuffer("image/png")).toFormat(extension).toBuffer();const r=await readProcessingFile(bytes,"contrato."+extension);assert.equal(r.problem,"",extension+JSON.stringify(r));assert.equal(r.needsReview,true);assert.ok(r.fields.cnpj?.includes("11.444.777/0001-61"),JSON.stringify(r));assert.ok(r.fields.remuneracao?.includes("11,84%"),JSON.stringify(r));}
});
test("PDF digitalizado passa por OCR e mantém leitura sujeita a conferência",async()=>{
 const r=await readProcessingFile(readingPdf(true),"digitalizado.pdf");assert.equal(r.problem,"",JSON.stringify(r));assert.equal(r.method,"PDF com OCR");assert.equal(r.needsReview,true);assert.ok(r.fields.remuneracao?.includes("11,84%"),JSON.stringify(r));
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

test("BMP passa por normalização local e DOC inválido não é aprovado",async()=>{
 const {data,info}=await sharp(readingImage().toBuffer("image/png")).removeAlpha().raw().toBuffer({resolveWithObject:true});
 const stride=Math.ceil(info.width*3/4)*4,bmp=Buffer.alloc(54+stride*info.height);bmp.write("BM");bmp.writeUInt32LE(bmp.length,2);bmp.writeUInt32LE(54,10);bmp.writeUInt32LE(40,14);bmp.writeInt32LE(info.width,18);bmp.writeInt32LE(info.height,22);bmp.writeUInt16LE(1,26);bmp.writeUInt16LE(24,28);
 for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){const input=(y*info.width+x)*3,output=54+(info.height-1-y)*stride+x*3;bmp[output]=data[input+2];bmp[output+1]=data[input+1];bmp[output+2]=data[input];}
 const r=await readProcessingFile(bmp,"imagem.bmp");assert.equal(r.problem,"");assert.equal(r.needsReview,true);assert.ok(r.fields.remuneracao?.includes("11,84%"));
 assert.ok((await readProcessingFile(Buffer.from("arquivo inválido"),"falso.doc")).problem);
});
