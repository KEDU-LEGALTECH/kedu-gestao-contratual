import { readDocument,readDocumentRegion } from "./file-reading-engine.js";
import { readingFailure } from "./file-reading.js";
import {closePaddle,resetPaddle} from './paddle-ocr.js';
// Serves consecutive files; the parent replaces this process after failures, time limits or a fixed number of files.
process.on("message",async(input:any)=>{
 resetPaddle();
 try {const reading=input.region?await readDocumentRegion(Buffer.from(input.bytes),input.name,input.region):await readDocument(Buffer.from(input.bytes),input.name,partial=>process.send?.({partial}));process.send?.({...reading,readerRssBytes:process.memoryUsage().rss});}
 catch(e:any){process.send?.(readingFailure(e?.message||"Não foi possível ler o arquivo. Confira se está íntegro e sem senha."));}
});
process.on("disconnect",()=>{closePaddle();process.exit(0);});
