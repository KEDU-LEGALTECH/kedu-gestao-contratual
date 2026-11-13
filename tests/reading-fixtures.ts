import { createCanvas } from "@napi-rs/canvas";
export function readingImage(blank=false) {
 const c=createCanvas(1500,400),x=c.getContext("2d");x.fillStyle="white";x.fillRect(0,0,1500,400);
 if(!blank){x.fillStyle="black";x.font="40px Arial";x.fillText("CNPJ: 11.444.777/0001-61",40,80);x.fillText("Taxa de remuneracao: 11,84%",40,160);}
 return c;
}
export function readingPdf(scan=false, pageCount=1) {
 const stream=(value:Buffer)=>Buffer.concat([Buffer.from(`<< /Length ${value.length} >>\nstream\n`),value,Buffer.from("\nendstream")]);
 const content=Buffer.from(scan?"q 600 0 0 160 0 500 cm /Im1 Do Q":"BT /F1 16 Tf 50 700 Td (CNPJ: 11.444.777/0001-61) Tj 0 -30 Td (Taxa de remuneracao: 11,84%) Tj ET");
 const objects=[Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources ${scan?"<< /XObject << /Im1 5 0 R >> >>":"<< /Font << /F1 5 0 R >> >>"} /Contents 4 0 R >>`),stream(content)];
 if(scan){const jpeg=readingImage().toBuffer("image/jpeg");objects.push(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 1500 /Height 400 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),jpeg,Buffer.from("\nendstream")]));}
 else objects.push(Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"));
 if(pageCount>1){
  const pages=[3];
  for(let i=1;i<pageCount;i++){pages.push(objects.length+1);objects.push(objects[2]);}
  objects[1]=Buffer.from(`<< /Type /Pages /Kids [${pages.map(page=>page+" 0 R").join(" ")}] /Count ${pages.length} >>`);
 }
 const parts=[Buffer.from("%PDF-1.4\n")],offsets=[0];let position=parts[0].length;
 objects.forEach((o,i)=>{offsets.push(position);const part=Buffer.concat([Buffer.from(`${i+1} 0 obj\n`),o,Buffer.from("\nendobj\n")]);parts.push(part);position+=part.length;});
 parts.push(Buffer.from(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,"0")+" 00000 n \n").join("")+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${position}\n%%EOF`));
 return Buffer.concat(parts);
}
/** Scanned first page, digital second page: OCR must not hide the latter. */
export function mixedReadingPdf() {
 const jpeg=readingImage().toBuffer('image/jpeg');
 const stream=(value:Buffer)=>Buffer.concat([Buffer.from(`<< /Length ${value.length} >>\nstream\n`),value,Buffer.from('\nendstream')]);
 const objects=[Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),Buffer.from('<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>'),Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>'),stream(Buffer.from('q 600 0 0 160 0 500 cm /Im1 Do Q')),Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 1500 /Height 400 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),jpeg,Buffer.from('\nendstream')]),Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 8 0 R >> >> /Contents 7 0 R >>'),stream(Buffer.from('BT /F1 16 Tf 50 700 Td (CNPJ: 00.817.900/0001-26) Tj 0 -30 Td (Valor contratual: 2000,00) Tj ET')),Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')];
 const parts=[Buffer.from('%PDF-1.4\n')],offsets=[0];let position=parts[0].length;
 objects.forEach((o,i)=>{offsets.push(position);const part=Buffer.concat([Buffer.from(`${i+1} 0 obj\n`),o,Buffer.from('\nendobj\n')]);parts.push(part);position+=part.length;});
 parts.push(Buffer.from(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${position}\n%%EOF`));
 return Buffer.concat(parts);
}
