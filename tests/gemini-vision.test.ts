import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readWithVision,visionConfig} from '../server/vision-reading.js';
const env={DOCUMENT_VISION_ENABLED:'true',DOCUMENT_VISION_PROVIDER:'gemini',GEMINI_API_KEY:'synthetic-key',DOCUMENT_VISION_MODEL:'test-model'};
test('free Gemini cannot process production attachments',async()=>{
 assert.equal(visionConfig(env).ready,false);
 assert.equal(await readWithVision(Buffer.from('x'),'real.txt','text',['razaoSocial'],async()=>{throw Error('Must not send');},env),null);
});
test('synthetic Gemini request uses inline image and JSON schema without exposing key in URL',async()=>{
 const sharp=(await import('sharp')).default;
 const bytes=await sharp({create:{width:20,height:20,channels:3,background:'white'}}).png().toBuffer();
 const result=await readWithVision(bytes,'synthetic.png','',['razaoSocial'],async(url,options)=>{
  assert.equal(String(url),'https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent');
  assert.equal(new Headers(options?.headers).get('x-goog-api-key'),'synthetic-key');
  const body=JSON.parse(String(options?.body));assert.ok(body.contents[0].parts.some((p:any)=>p.inlineData?.mimeType==='image/png'));
  assert.equal(body.generationConfig.responseMimeType,'application/json');
  return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({observations:[{key:'razaoSocial',value:'Empresa Ficticia',entity:'Empresa Ficticia',role:'company',page:1,excerpt:'Razao social: Empresa Ficticia'}]})}]}}]}));
 },env,true);
 assert.equal(result?.status,'completed');assert.equal(result?.observations.length,1);
});
test('quota and blocked outputs preserve local reading and expose no provider secrets',async()=>{
 for(const response of [new Response('{}',{status:429}),new Response(JSON.stringify({promptFeedback:{blockReason:'SAFETY'}}))]){
  const result=await readWithVision(Buffer.from('x'),'synthetic.txt','Empresa Ficticia',['razaoSocial'],async()=>response,env,true);
  assert.equal(result?.status,'failed');assert.deepEqual(result?.observations,[]);assert.equal(JSON.stringify(result).includes('synthetic-key'),false);
 }
});
