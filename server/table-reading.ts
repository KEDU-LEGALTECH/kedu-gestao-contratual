export type PositionedText={str:string;transform:number[];width?:number;height?:number;hasEOL?:boolean};
/** Reconstructs row/cell boundaries from PDF coordinates, without changing source text. */
export function positionedRows(items:PositionedText[]) {
 const rows:{y:number;items:PositionedText[]}[]=[];
 for(const item of items){
  if(!item.str?.trim()||!Number.isFinite(item.transform?.[4])||!Number.isFinite(item.transform?.[5]))continue;
  // Rotated/vertical text is left to the ordinary parser/OCR.
  if(Math.abs(item.transform[1])>0.1||Math.abs(item.transform[2])>0.1)continue;
  const y=item.transform[5],row=rows.find(r=>Math.abs(r.y-y)<=2);
  if(row)row.items.push(item);else rows.push({y,items:[item]});
 }
 return rows.sort((a,b)=>b.y-a.y).map(row=>{
  const cells:string[]=[];let end=-Infinity;
  for(const item of row.items.sort((a,b)=>a.transform[4]-b.transform[4])){
   const gap=item.transform[4]-end,threshold=Math.max(12,Math.abs(item.height||item.transform[3]||10)*1.8);
   if(!cells.length||gap>threshold)cells.push(item.str.trim());else cells[cells.length-1]+=(gap>1?' ':'')+item.str;
   end=item.transform[4]+Math.max(0,item.width||0);
  }
  return cells.map(s=>s.trim()).filter(Boolean);
 });
}
