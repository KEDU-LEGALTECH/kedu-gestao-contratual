import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {readLocalDocument} from '../server/local-document-vision.js';
test('local pilot rejects cloud models before network access',async()=>{
 await assert.rejects(readLocalDocument(Buffer.from('x'),['cnpj'],'qwen3-vl:235b-cloud'),/cloud/);
});
test('local pilot sends only image and field names to loopback; never approves',async()=>{
 const png=await sharp({create:{width:10,height:10,channels:3,background:'white'}}).png().toBuffer();
 const result=await readLocalDocument(png,['cidade'],'qwen3-vl:2b',async(url,options)=>{
  assert.equal(url,'http://127.0.0.1:11434/api/chat');assert.equal(options?.redirect,'error');const body=JSON.parse(String(options?.body));
  assert.equal(body.keep_alive,0);assert.equal(body.stream,false);assert.equal(body.options.num_ctx,4096);assert.equal(body.messages[0].images.length,1);
  return new Response(JSON.stringify({done:true,done_reason:'stop',message:{content:JSON.stringify({observations:[{field:'cidade',value:'Cidade Exemplo',entity:'Empresa Fictícia',page:1,excerpt:'Cidade: Cidade Exemplo'}]})}}));
 });assert.equal(result.automaticApproval,false);assert.equal(result.observations.length,1);
});

test('local reader rejects narrative responses instead of treating them as extracted data',async()=>{
 const png=await sharp({create:{width:10,height:10,channels:3,background:'white'}}).png().toBuffer();
 await assert.rejects(readLocalDocument(png,['cnpj'],'qwen3-vl:2b-instruct',async()=>new Response(JSON.stringify({done:true,message:{content:'I will analyze the document'}}))));
});

test('local reader rejects fields without matching evidence and truncated answers',async()=>{
 const png=await sharp({create:{width:10,height:10,channels:3,background:'white'}}).png().toBuffer();
 await assert.rejects(readLocalDocument(png,['cidade'],'qwen3-vl:2b-instruct',async()=>new Response(JSON.stringify({done:true,message:{content:JSON.stringify({observations:[{field:'cidade',value:'Salvador',entity:'Empresa',page:1,excerpt:'Cidade: Candeias'}]})}}))),/evidência/);
 await assert.rejects(readLocalDocument(png,['cidade'],'qwen3-vl:2b-instruct',async()=>new Response(JSON.stringify({done:true,done_reason:'length',message:{content:'{}'}}))),/incompleta/);
});

test('local reader requires the value in the quote even when the label is correct',async()=>{
 const png=await sharp({create:{width:10,height:10,channels:3,background:'white'}}).png().toBuffer();
 await assert.rejects(readLocalDocument(png,['razaoSocial'],'qwen3-vl:2b-instruct',async(_url,options)=>{
  const body=JSON.parse(String(options?.body));
  assert.match(body.messages[0].content,/Citar somente/);
  assert.match(body.format.properties.observations.items.properties.excerpt.description,/VALOR/);
  return new Response(JSON.stringify({done:true,message:{content:JSON.stringify({observations:[{field:'razaoSocial',value:'EMPRESA EXEMPLO LTDA',entity:'EMPRESA EXEMPLO LTDA',page:1,excerpt:'NOME EMPRESARIAL'}]})}}));
 }),/evidência/);
});

test('local reader rejects reusing a trade-name quote as the legal-name evidence',async()=>{
 const png=await sharp({create:{width:10,height:10,channels:3,background:'white'}}).png().toBuffer();
 await assert.rejects(readLocalDocument(png,['razaoSocial','nomeFantasia'],'qwen3-vl:2b-instruct',async()=>new Response(JSON.stringify({done:true,message:{content:JSON.stringify({observations:['razaoSocial','nomeFantasia'].map(field=>({field,value:'ESCOLA EXEMPLO',entity:'',page:1,excerpt:'ESCOLA EXEMPLO'}))})}}))),/Associação ambígua/);
});
