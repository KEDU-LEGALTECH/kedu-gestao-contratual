import sharp from "sharp";
import {prepareImage} from "./image-input.js";
/** An image without contrast (background tint, watermark, blank scan) cannot carry text.
 * Measured on real attachments: such images had grayscale deviation below 8, while
 * logos, signatures and printed text stay well above 20. Only then may an unreadable
 * embedded image be left out without marking the document as partially read. */
export async function lacksVisibleContent(bytes:Buffer,maxDeviation=12) {
 try{
  const stats=await sharp(await prepareImage(bytes),{limitInputPixels:24000000}).flatten({background:"#fff"}).grayscale().resize({width:600,withoutEnlargement:true}).stats();
  return stats.channels[0].stdev<maxDeviation;
 }catch{return false;}
}
