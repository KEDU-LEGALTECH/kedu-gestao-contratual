type CachedFile={bytes?:{length:number};byteLength?:number;problem?:string;extracted:string;name?:string};
/** Reader versions invalidate caches, not successful saved observations. */
export function needsReadingRecovery(file:CachedFile|undefined) {
 if(!file||(file.byteLength??file.bytes?.length??0)===0)return true;
 try{
  const r=JSON.parse(file.extracted);
  if(r.decorative===true||r.method==='Imagem decorativa')return false;
  // Trying again cannot read a format without a reader, such as a ZIP.
  if(/formato sem leitor/i.test(String(file.problem||r.problem||'')))return false;
  if(file.problem||r.problem||r.incomplete||r.transient)return true;
  // A complete reading with text but no recognized field gives the same result when
  // repeated; it goes to review instead of consuming retries. Only empty text is retried.
  return Object.keys(r.fields||{}).length===0&&!String(r.text||'').trim();
 }catch{return true;}
}
/** A temporary engine failure must not destroy any usable previous extraction. */
export function preservePreviousReading(previous:string|undefined,next:{transient?:boolean;problem?:string}) {
 if(!previous||!next.transient)return false;
 try{const r=JSON.parse(previous);return !r.problem&&!!(r.text?.trim()||Object.keys(r.fields||{}).length);}catch{return false;}
}
