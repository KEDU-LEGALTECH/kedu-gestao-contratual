/** Small logos/signatures do not replace a sufficiently populated digital text layer.
 * Large scanned regions, unknown image transforms and sparse text still require OCR.
 */
export function needsPdfOcr(text:string,ops:{fnArray:number[];argsArray:any[]},codes:Record<string,number>,pageArea:number) {
 if(text.trim().length<300)return true;
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
  }else if([codes.paintImageXObjectRepeat,codes.paintInlineImageXObjectGroup,codes.paintImageMaskXObject,codes.paintImageMaskXObjectRepeat,codes.paintImageMaskXObjectGroup].includes(op))return true;
 }
 return !Number.isFinite(pageArea)||pageArea<=0||!Number.isFinite(area)||area/pageArea>0.15;
}
