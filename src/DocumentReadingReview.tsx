import {useEffect,useState} from 'react';

export function FieldReadingReview({file,revision,confirm,correct,busy}:any) {
 const [checked,setChecked]=useState<Record<string,boolean>>({});
 useEffect(()=>setChecked({}),[file.id,revision]);
 return <details className="pending-groups"><summary>Conferir campos individualmente ({file.fieldReviews?.length||0})</summary>
  <p className="muted">Confirmar registra a leitura do original. Divergências com o GLPI e decisões jurídicas continuam pendentes.</p>
  {(file.fieldReviews||[]).map((field:any)=><section className="reading-confirmation" key={field.key}>
   <h3>{field.label}</h3><p>Encontrado: <strong>{field.values.join(' / ')}</strong></p>
   {!!field.expected?.length&&<p>Solicitado no GLPI: {field.expected.join(' / ')}</p>}
   {field.excerpt?<blockquote style={{whiteSpace:'pre-wrap'}}>{field.excerpt}</blockquote>:<p className="muted">Trecho não localizado. Confira o arquivo original.</p>}
   {field.confirmed?<p className="positive">Leitura conferida nesta versão.</p>:confirm&&file.available&&!file.incomplete&&field.values.length===1?<><label><input type="checkbox" checked={!!checked[field.key]} onChange={e=>setChecked({...checked,[field.key]:e.target.checked})}/> Conferi este campo no original</label><button type="button" className="secondary" disabled={busy||!checked[field.key]} onClick={()=>confirm(file.id,field.key,field.values[0],revision)}>Confirmar leitura deste campo</button></>:<p className="muted">Valores ambíguos ou leitura incompleta precisam de correção ou nova cópia.</p>}
  </section>)}
  {correct&&file.available&&!file.incomplete&&!file.problem&&<details><summary>Corrigir ou completar a transcrição de um campo</summary><p>Copie o valor e o trecho que você conferiu no original. Isso corrige a leitura, preserva o arquivo e registra um exemplo para medir o leitor.</p><form onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);correct(file.id,String(data.get('field')),String(data.get('value')),String(data.get('evidence')),revision);}}>
   <label>Campo<select name="field" required>{(file.fieldReviews||[]).map((f:any)=><option key={f.key} value={f.key}>{f.label}</option>)}</select></label>
   <label>Valor no original<input name="value" required maxLength={500}/></label>
   <label>Trecho do original contendo o valor<textarea name="evidence" required minLength={5} maxLength={2000}/></label>
   <label><input type="checkbox" required/> Conferi o valor no documento original</label>
   <button className="secondary" disabled={busy}>Salvar transcrição conferida</button>
  </form></details>}
 </details>;
}

export function RegionReading({did,file,revision,api}:any) {
 const [region,setRegion]=useState({page:1,x:0,y:0,width:1,height:1,rotation:0});
 const [result,setResult]=useState<any>(null),[error,setError]=useState(''),[working,setWorking]=useState(false);
 useEffect(()=>{setResult(null);setError('');setRegion({page:1,x:0,y:0,width:1,height:1,rotation:0});},[file.id,revision]);
 if(!api||!file.available||!/\.(pdf|png|jpe?g|webp|tiff?|bmp|gif)$/i.test(file.name))return null;
 const read=async()=>{setWorking(true);setError('');setResult(null);try {setResult(await api(`/demands/${did}/processing/files/${file.id}/region`,{revision,region}));}catch(e:any){setError(e.message||'Não foi possível reler o trecho.');}finally{setWorking(false);}};
 return <details className="pending-groups"><summary>Reler uma região com OCR</summary>
  <p className="muted">Use a prévia original acima como referência. Indique a posição do trecho em porcentagem, a partir do canto superior esquerdo. A leitura amplia o recorte e tenta melhorar o contraste.</p>
  <div style={{display:'flex',flexWrap:'wrap',gap:12}}>
   <label>Página<input type="number" min="1" max={file.pages||30} value={region.page} onChange={e=>setRegion({...region,page:Number(e.target.value)})}/></label>
   {(['x','y','width','height'] as const).map((key,index)=><label key={key}>{['Esquerda (%)','Topo (%)','Largura (%)','Altura (%)'][index]}<input type="number" min={index>1?2:0} max="100" value={Math.round(region[key]*100)} onChange={e=>setRegion({...region,[key]:Number(e.target.value)/100})}/></label>)}
   <label>Rotação<select value={region.rotation} onChange={e=>setRegion({...region,rotation:Number(e.target.value)})}>{[0,90,180,270].map(v=><option key={v} value={v}>{v}°</option>)}</select></label>
  </div>
  <button type="button" className="secondary" disabled={working} onClick={read}>{working?'Lendo trecho…':'Ler região selecionada'}</button>
  {working&&<p role="status">Processando OCR local. Esta leitura pode levar alguns minutos.</p>}
  {error&&<p role="alert">{error}</p>}
  {result&&<div role="status"><p>{result.problem||'Leitura auxiliar concluída. Confira antes de usar os valores na correção.'}</p>{result.text&&<pre>{result.text}</pre>}<p className="muted">O original e os dados da demanda não foram alterados. Registre os valores conferidos na seção de correção.</p></div>}
 </details>;
}
