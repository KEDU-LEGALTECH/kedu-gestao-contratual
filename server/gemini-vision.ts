/** Translate the independent extraction request; no GLPI reference is passed. */
export function geminiTransport(fetcher:typeof fetch=fetch):typeof fetch {
 return async(_url,options)=>{
  const request=JSON.parse(String(options?.body));
  const headers=new Headers(options?.headers),key=(headers.get('Authorization')||'').replace(/^Bearer /,'');
  if(!/^[a-zA-Z0-9._-]+$/.test(request.model))throw Error('Invalid model');
  const parts=request.input[0].content.map((part:any)=>{
   if(part.type==='input_text')return {text:part.text};
   const data=part.type==='input_image'?part.image_url:part.file_data;
   const match=/^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/.exec(data);if(!match)throw Error('Invalid media');
   return {inlineData:{mimeType:match[1],data:match[2]}};
  });
  const response=await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${request.model}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},signal:options?.signal,body:JSON.stringify({contents:[{role:'user',parts}],generationConfig:{candidateCount:1,maxOutputTokens:5000,responseMimeType:'application/json',responseJsonSchema:request.text.format.schema}})});
  if(!response.ok)return new Response('{}',{status:response.status});
  const payload=await response.json() as any,candidate=payload.candidates?.[0];
  if(payload.promptFeedback?.blockReason||candidate?.finishReason!=='STOP')return new Response(JSON.stringify({status:'incomplete'}));
  const text=(candidate.content?.parts||[]).filter((p:any)=>!p.thought&&typeof p.text==='string').map((p:any)=>p.text).join('');
  return new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text}]}]}));
 };
}
