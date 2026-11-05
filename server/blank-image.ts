/** A PNG without recognized text that compresses to a few bytes per thousand pixels is a blank image:
 * the requester sent no document, so OCR is not to blame. Uses only the IHDR header (no decoding). */
export function blankImage(f:{problem?:string|null;head?:Uint8Array|null;byteLength?:number}) {
 const h=f.head?Buffer.from(f.head):undefined;
 if(!f.problem||!/nenhum texto leg|imagem em branco/i.test(f.problem)||!h||h.length<24||h.readUInt32BE(0)!==0x89504e47)return false;
 const pixels=h.readUInt32BE(16)*h.readUInt32BE(20);
 return pixels>=10000&&(f.byteLength||0)/pixels<0.03;
}
export const blankImageMessage='Imagem em branco: o anexo não contém documento. Solicite ao requerente o envio do documento correto.';
