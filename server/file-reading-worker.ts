import { readDocument } from "./file-reading-engine.js";
import { readingFailure } from "./file-reading.js";
process.once("message",async(input:any)=>{
 try {process.send?.(await readDocument(Buffer.from(input.bytes),input.name));}
 catch(e:any){process.send?.(readingFailure(e?.message||"Não foi possível ler o arquivo. Confira se está íntegro e sem senha."));}
});
