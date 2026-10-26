import { readDocument,readDocumentRegion } from "./file-reading-engine.js";
import { readingFailure } from "./file-reading.js";
import {closePaddle} from './paddle-ocr.js';
process.once("message",async(input:any)=>{
 try {process.send?.(input.region?await readDocumentRegion(Buffer.from(input.bytes),input.name,input.region):await readDocument(Buffer.from(input.bytes),input.name,partial=>process.send?.({partial})));}
 catch(e:any){process.send?.(readingFailure(e?.message||"Não foi possível ler o arquivo. Confira se está íntegro e sem senha."));}
 finally{closePaddle();}
});
