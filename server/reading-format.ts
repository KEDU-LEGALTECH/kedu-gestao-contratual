import PizZip from 'pizzip';
/** Dispatch by actual content; a renamed image/Word file is still readable. */
export function readingFilename(bytes:Buffer,name:string){
 let extension:string|undefined;
 if(bytes.subarray(0,5).toString()==='%PDF-')extension='pdf';
 else if(bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a')extension='png';
 else if(bytes.subarray(0,3).toString('hex')==='ffd8ff')extension='jpeg';
 else if(/^GIF8[79]a$/.test(bytes.subarray(0,6).toString()))extension='gif';
 else if(['49492a00','4d4d002a'].includes(bytes.subarray(0,4).toString('hex')))extension='tiff';
 else if(bytes.subarray(0,2).toString()==='BM')extension='bmp';
 else if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')extension='webp';
 else if(bytes.subarray(0,2).toString()==='PK'){
  try{const zip=new PizZip(bytes);extension=zip.file('word/document.xml')?'docx':zip.file('xl/workbook.xml')?'xlsx':zip.file('ppt/presentation.xml')?'pptx':undefined;}catch{}
 }
 return extension?'conteudo.'+extension:name;
}
