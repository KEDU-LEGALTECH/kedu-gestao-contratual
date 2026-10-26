import { useState,useEffect } from "react";

function MarkedText({text,issues}:any) {
 const terms=[...new Set<string>(issues.map((i:any)=>i.found).filter((s:any)=>typeof s==="string" && s.trim().length>1))].sort((a,b)=>b.length-a.length);
 if(!terms.length)return <>{text}</>;
 const pattern=new RegExp(`(${terms.map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("|")})`,"g");
 return <>{text.split(pattern).map((part:string,n:number)=>terms.includes(part)?<mark key={n} title="Valor apontado na análise; confira a pendência ao lado">{part}</mark>:part)}</>;
}

export function ReceivedDocuments({did,files,issues,revision,confirm,busy}:any) {
 const [selected,setSelected]=useState<string|null>(null);
 const [checked,setChecked]=useState(false);
 useEffect(()=>{setSelected(current=>current && files.some((f:any)=>f.id===current)?current:files[0]?.id||null);},[files.map((f:any)=>f.id).join(',')]);
 useEffect(()=>setChecked(false),[revision,selected]);
 const file=files.find((f:any)=>f.id===selected);
 const visibleIssues=issues.filter((i:any)=>!i.message.startsWith("Preencha este dado:") && (!i.field.startsWith("review:")||i.field==="review:"+file?.id) && (!i.field.startsWith("file:")||i.field==="file:"+file?.document_id));
 const missingCount=issues.filter((i:any)=>i.message.startsWith("Preencha este dado:")).length;
 return <section id="documento-recebido" className="panel received-documents">
  <h2>Documento preenchido recebido do GLPI</h2>
  <p className="muted">Você pode conferir e baixar o arquivo recebido mesmo com erros. O download do contrato final depende da correção das pendências.</p>
  {!files.length && <p>Nenhum arquivo disponível para visualização. Atualize a leitura para tentar importar novamente.</p>}
  {files.map((f:any)=><div className="received-file" key={f.id}><div><strong>{f.name}</strong><small>{f.corrected?"Cópia corrigida no portal":"Original recebido do GLPI"} · {f.problem?"Leitura inconclusiva":f.needsReview?"Texto extraído — conferir leitura":f.method||"Texto extraído"}</small></div><button type="button" className="secondary" aria-expanded={selected===f.id} onClick={()=>{setSelected(selected===f.id?null:f.id);setChecked(false);}}>Mostrar documento</button><a className="secondary" href={`/api/demands/${did}/processing/files/${f.id}`}>Baixar arquivo recebido</a></div>)}
  {file && <div className="received-review">
   {file.readingValidatedAutomatically && <p className="positive" role="status">Leitura dos campos validada automaticamente. As demais pendências da demanda continuam sendo verificadas.</p>}
   {file.incomplete && <p className="inline-warning" role="alert">Leitura parcial. Os trechos abaixo foram preservados, mas o restante do arquivo ainda precisa ser lido. Envie uma cópia dividida em partes ou com texto acessível; confirmar apenas este trecho não libera o contrato.</p>}
   {file.role==='counterproposal' && <p className="inline-warning">Contraproposta: este arquivo contém pedidos de alterações. As condições propostas precisam ser conferidas antes de preencher o contrato.</p>}
   {file.role==='report' && <p className="muted">Relatório de apoio. Seus valores não foram adotados como condições do contrato. O original continua disponível para consulta.</p>}
   {!!file.reviewFields?.length && <p className="muted">Campos identificados neste arquivo: {file.reviewFields.join(', ')}.</p>}
   {!!file.warnings?.length && <div className="inline-warning" role="note">{file.warnings.map((warning:string)=><p key={warning}>{warning}</p>)}</div>}
   <div className="received-preview"><div className="received-document-title"><strong>Arquivo em conferência</strong><h3>{file.name}</h3>{file.identification?.type && <p>Tipo encontrado: <strong>{file.identification.type}</strong> · {file.identification.source}</p>}</div>{/\.(pdf|png|jpe?g|webp|gif|tiff?|bmp)$/i.test(file.name) && <a className="secondary" href={`/api/demands/${did}/processing/files/${file.id}/view`} target="_blank" rel="noreferrer">Abrir original em outra aba</a>}
    {/\.(png|jpe?g|webp|gif|tiff?|bmp)$/i.test(file.name)?<><img src={`/api/demands/${did}/processing/files/${file.id}/view`} alt={`Documento recebido: ${file.name}`}/>{file.pages>1 && <p className="muted">Prévia da primeira página/quadro. Baixe o original para conferir todas as páginas; o texto abaixo inclui a leitura de todas elas.</p>}</>: /\.pdf$/i.test(file.name)?<iframe title={file.name} src={`/api/demands/${did}/processing/files/${file.id}/view`}/>:!file.text?<p>Baixe o original para conferir sua formatação.</p>:null}
    {file.text && <><h3>Texto extraído para conferência</h3><p className="muted">{file.method || "Leitura do documento"}{file.pages?` · ${file.pages} página(s)/quadro(s)`:""}. Confira números, nomes e trechos omitidos com o original. Os destaques mostram correspondências exatas com os valores sinalizados.</p>{typeof file.confidence==="number" && <p className="muted">Confiança estimada do OCR: {Math.round(file.confidence)}%. Esta estimativa não garante que todos os dados estejam corretos.</p>}<pre><MarkedText text={file.text} issues={issues}/></pre></>}
    {file.needsReview && confirm && <div className="reading-confirmation" key={file.id+revision}><label><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/> Comparei o texto extraído com o arquivo original e conferi os valores que serão utilizados.</label><button type="button" className="primary" disabled={busy||!checked} onClick={()=>{confirm(file.id,revision);setChecked(false);}}>Confirmar conferência da leitura</button><p className="muted">Se houver erro de leitura, corrija os dados ou envie uma cópia melhor antes de confirmar.</p></div>}
   </div>
   <aside aria-label="Pendências da análise"><h3>Sinalizações da análise</h3><p className="muted">Inclui pendências deste documento e da demanda. Quando não for possível localizar o trecho, a sinalização aparece somente nesta lista.</p>{visibleIssues.length?<ul>{visibleIssues.map((i:any,n:number)=><li key={n}><strong>{i.label?.startsWith("file:")?i.source||"Documento":i.label}</strong><p>{i.message}</p>{i.found && <p>Encontrado: <mark>{i.found}</mark></p>}{i.expected && <p>Como deve ficar: <strong>{i.expected}</strong></p>}</li>)}</ul>:<p>Nenhuma divergência identificada neste arquivo pela análise automática.</p>}{missingCount>0 && <p className="muted">Há também {missingCount} dados obrigatórios não identificados. Eles podem estar em outros documentos. Confira a leitura antes de completar os campos na seção de pendências.</p>}</aside>
  </div>}
 </section>;
}
