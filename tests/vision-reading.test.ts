import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {readWithVision,visionConfig,visionSignature,shouldReadVision} from '../server/vision-reading.js';
const env={DOCUMENT_VISION_ENABLED:'true',OPENAI_API_KEY:'test-only',DOCUMENT_VISION_MODEL:'test-model'};
const observation={key:'razaoSocial',value:'Empresa Exemplo',entity:'Empresa Exemplo',role:'company',page:1,excerpt:'Razão social: Empresa Exemplo'};
function reply(observations:any[]){return new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({observations})}]}]}));}
test('disabled or incomplete configuration never sends documents',async()=>{
 const fail=async()=>{throw Error('Network must not run');};
 assert.equal(await readWithVision(Buffer.from('x'),'x.txt','text',['razaoSocial'],fail,{}),null);
 assert.equal(visionConfig({...env,OPENAI_API_KEY:''}).ready,false);
});
test('independent extraction is unconfirmed and retains provenance',async()=>{
 let body:any;
 const fetcher:typeof fetch=async(_url,options)=>{body=JSON.parse(String(options?.body));return reply([observation]);};
 const result=await readWithVision(Buffer.from('local'),'x.docx','Razão social: Empresa Exemplo',['razaoSocial'],fetcher,env);
 assert.equal(result?.status,'completed');assert.equal(result?.mode,'text');assert.equal(result?.partial,true);
 assert.deepEqual(result?.observations,[observation]);assert.equal(body.store,false);
 assert.equal(body.text.format.strict,true);assert.equal(JSON.stringify(body).includes('test-only'),false);
 assert.equal('fields' in result!,false);assert.equal('confirmed' in result!,false);
});
test('rejects invented excerpts, unknown keys, and pages',async()=>{
 for(const bad of [{...observation,excerpt:'Outro trecho sem o valor'},{...observation,page:2},{...observation,key:'unknown'}]){
  const result=await readWithVision(Buffer.from('x'),'x.txt','text',['razaoSocial'],async()=>reply([bad]),env);
  assert.equal(result?.status,'failed');assert.deepEqual(result?.observations,[]);
 }
});
test('provider failure is sanitized and deduplicated',async()=>{
 const result=await readWithVision(Buffer.from('x'),'x.txt','text',['razaoSocial'],async()=>{throw Error('secret server information');},env);
 assert.equal(result?.status,'failed');assert.equal(JSON.stringify(result).includes('secret server'),false);
 assert.equal(shouldReadVision(result!,visionSignature(Buffer.from('x'),['razaoSocial'],env.DOCUMENT_VISION_MODEL)),false);
 assert.equal(shouldReadVision(result!,visionSignature(Buffer.from('new'),['razaoSocial'],env.DOCUMENT_VISION_MODEL)),true);
});
test('image is sent visually, while the original local extraction remains separate',async()=>{
 const bytes=await sharp({create:{width:20,height:20,channels:3,background:'white'}}).png().toBuffer();
 let content:any[]=[];
 const result=await readWithVision(bytes,'scan.png','',['razaoSocial'],async(_url,options)=>{content=JSON.parse(String(options?.body)).input[0].content;return reply([observation]);},env);
 assert.equal(result?.mode,'image');assert.equal(result?.partial,false);assert.deepEqual(result?.pages,[1]);
 assert.ok(content.some(c=>c.type==='input_image'&&c.image_url.startsWith('data:image/png;base64,')));
});
