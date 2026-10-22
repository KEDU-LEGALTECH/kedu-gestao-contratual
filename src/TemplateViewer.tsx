import {useState} from "react";

/** Text-only inspection of the stored version; never changes approval state. */
export function TemplateViewer({id,api}:{id:string;api:(path:string)=>Promise<any>}) {
 const [open,setOpen]=useState(false),[document,setDocument]=useState<any>(null),[error,setError]=useState(""),[loading,setLoading]=useState(false);
 async function show(){
  if(open){setOpen(false);return;}
  setOpen(true);setError("");setLoading(true);
  try{setDocument(await api(`/templates/${id}/view`));}catch(e:any){setError(e.message||"Não foi possível abrir o modelo.");}finally{setLoading(false);}
 }
 return <div className="template-viewer">
  <button type="button" className="secondary" aria-expanded={open} onClick={show}>{open?"Fechar visualização":"Visualizar modelo"}</button>
  {open && <div className="template-text-preview" role="region" aria-label="Visualização do modelo">
   {loading?<p role="status">Carregando modelo…</p>:error?<p role="alert">{error}</p>:document && <>
    <h3>{document.name} · Versão {document.version}</h3>
    <p className="muted">Texto do modelo com os campos de preenchimento. Esta visualização não reproduz a diagramação do Word e não aprova o modelo para uso.</p>
    {document.paragraphs.map((p:string,i:number)=><p key={i}>{p}</p>)}
   </>}
  </div>}
 </div>;
}
