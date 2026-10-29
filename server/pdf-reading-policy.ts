/** Small logos/signatures do not replace a sufficiently populated digital text layer.
 * Large scanned regions, unknown image transforms and sparse text still require OCR.
 */
export function needsPdfOcr(text:string,ops:{fnArray:number[];argsArray:any[]},codes:Record<string,number>,pageArea:number) {
 if(text.trim().length<80||/[\uFFFD\x00]/.test(text))return true;
 let matrix=[1,0,0,1,0,0],area=0;const stack:number[][]=[];
 for(let i=0;i<ops.fnArray.length;i++){
  const op=ops.fnArray[i],args=ops.argsArray[i];
  if(op===codes.save)stack.push([...matrix]);
  else if(op===codes.restore){const previous=stack.pop();if(!previous)return true;matrix=previous;}
  else if(op===codes.transform){
   if(!Array.isArray(args)||args.length!==6||args.some(n=>!Number.isFinite(n)))return true;
   const [a,b,c,d,e,f]=matrix,[g,h,j,k,l,m]=args;
   matrix=[a*g+c*h,b*g+d*h,a*j+c*k,b*j+d*k,a*l+c*m+e,b*l+d*m+f];
  }else if(op===codes.paintImageXObject||op===codes.paintInlineImageXObject){
   area+=Math.abs(matrix[0]*matrix[3]-matrix[1]*matrix[2]);
  }else if(op===codes.paintImageMaskXObject){
   area+=Math.abs(matrix[0]*matrix[3]-matrix[1]*matrix[2]);
  }else if(op===codes.paintImageXObjectRepeat){
   const sx=args?.[1],sy=args?.[2],positions=args?.[3];
   if(!Number.isFinite(sx)||!Number.isFinite(sy)||!positions||positions.length%2||!Array.from(positions as ArrayLike<number>).every(Number.isFinite))return true;
   area+=Math.abs((matrix[0]*matrix[3]-matrix[1]*matrix[2])*sx*sy)*positions.length/2;
  }else if(op===codes.paintImageMaskXObjectRepeat){
   const sx=args?.[1],kx=args?.[2],ky=args?.[3],sy=args?.[4],positions=args?.[5];
   if(![sx,kx,ky,sy].every(Number.isFinite)||!positions||positions.length%2||!Array.from(positions as ArrayLike<number>).every(Number.isFinite))return true;
   area+=Math.abs((matrix[0]*matrix[3]-matrix[1]*matrix[2])*(sx*sy-kx*ky))*positions.length/2;
  }else if(op===codes.paintInlineImageXObjectGroup||op===codes.paintImageMaskXObjectGroup){
   const images=op===codes.paintInlineImageXObjectGroup?args?.[1]:args?.[0];
   if(!Array.isArray(images))return true;
   for(const image of images){const t=image?.transform;if(!t||t.length!==6||!Array.from(t as ArrayLike<number>).every(Number.isFinite))return true;area+=Math.abs((matrix[0]*matrix[3]-matrix[1]*matrix[2])*(t[0]*t[3]-t[1]*t[2]));}
  }
 }
 return !Number.isFinite(pageArea)||pageArea<=0||!Number.isFinite(area)||area/pageArea>0.15;
}
/** Finish useful pages and resume the rest; dividing by all pages can starve every OCR attempt. */
export function pdfPageBudget(remainingMs:number,registration=false){return Math.floor(Math.max(0,Math.min(registration?70000:35000,remainingMs)));}
