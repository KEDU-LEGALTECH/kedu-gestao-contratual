import {createCanvas,loadImage} from "@napi-rs/canvas";
/** libvips does not decode BMP; convert with the local canvas decoder. */
export async function prepareImage(bytes:Buffer) {
 if(bytes.subarray(0,2).toString()!=="BM")return bytes;
 if(bytes.length<54 || bytes.readUInt32LE(14)<40)throw Error("BMP inválido ou variante não suportada.");
 const width=Math.abs(bytes.readInt32LE(18)),height=Math.abs(bytes.readInt32LE(22));
 if(!width || !height || width*height>24000000)throw Error("Imagem BMP excede 24 milhões de pixels.");
 const image=await loadImage(bytes),canvas=createCanvas(width,height);
 canvas.getContext("2d").drawImage(image,0,0);return canvas.toBuffer("image/png");
}
