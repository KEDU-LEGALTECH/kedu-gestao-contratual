import {sameRequestedValue} from './request-expectations.js';
/** Only observations made in the received files; the GLPI reference is never a quote. */
export function comparisonSources(row:any,files:any[]){
 if(!row.found)return [];
 const found=String(row.found).split('; ').filter(Boolean);
 return files.flatMap(file=>{
  const review=file.fieldReviews?.find((r:any)=>r.key===row.field);
  if(!review)return [];
  return (review.values||[]).filter((value:string)=>found.some(v=>sameRequestedValue(row.field,value,v))).map((value:string)=>{
   const observation=review.observations?.find((o:any)=>sameRequestedValue(row.field,o.value,value))||(review.values.length===1?review:{});
   return {
   fileId:file.id,fileName:file.name,value,
   page:Number.isInteger(observation.page)&&observation.page>0?observation.page:undefined,
   excerpt:observation.excerpt||'',available:file.available!==false,
  };});
 });
}
