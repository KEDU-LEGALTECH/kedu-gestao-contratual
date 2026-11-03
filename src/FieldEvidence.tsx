import React from 'react';
/** Highlight actual source characters, preserving accents and number punctuation. */
export function evidenceParts(text:string,value:string){
 const indexes:number[]=[],letters:string[]=[];
 for(let i=0;i<text.length;i++)for(const c of text[i].normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase())if(/[a-z0-9]/.test(c)){indexes.push(i);letters.push(c);}
 const needle=value.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
 if(needle.length<3)return [{text,marked:false}];
 const compact=letters.join(''),parts:{text:string;marked:boolean}[]=[];
 let offset=0,at=compact.indexOf(needle);
 while(at>=0){const start=indexes[at],end=indexes[at+needle.length-1]+1;parts.push({text:text.slice(offset,start),marked:false},{text:text.slice(start,end),marked:true});offset=end;at=compact.indexOf(needle,at+needle.length);}
 parts.push({text:text.slice(offset),marked:false});return parts;
}
export function FieldEvidence({evidence,found,did}:{evidence?:any[];found?:string;did?:string}){
 if(!found)return null;
 if(!evidence?.length)return <small>Trecho e página de origem ainda não localizados.</small>;
 return <div className="field-evidence">{evidence.map((e,i)=><div className="field-evidence-item" key={e.fileId+'-'+i}>
  <strong>{e.fileName}</strong><small>{e.page?`Página ${e.page}`:'Página não identificada'}</small>
  {e.excerpt?<blockquote>{evidenceParts(e.excerpt,e.value).map((part,n)=>part.marked?<mark key={n}>{part.text}</mark>:<React.Fragment key={n}>{part.text}</React.Fragment>)}</blockquote>:<p className="muted">Trecho de origem ainda não localizado.</p>}
  {did&&e.available&&<a href={`/api/demands/${encodeURIComponent(did)}/processing/files/${encodeURIComponent(e.fileId)}/view${e.page?'#page='+e.page:''}`} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${e.fileName}${e.page?', página '+e.page:''} em outra aba`}>Abrir original{e.page?' na página '+e.page:''} ↗</a>}
 </div>)}</div>;
}
