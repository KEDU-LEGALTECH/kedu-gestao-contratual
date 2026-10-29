import 'dotenv/config';
import sharp from 'sharp';
import {readWithVision} from './vision-reading.js';
// Deliberately accepts no filenames or document input: only this invented fixture is sent.
const expected={razaoSocial:'EMPRESA FICTICIA DE TESTE LTDA',nomeFantasia:'ESCOLA EXEMPLO FICTICIO',cidade:'CIDADE DE TESTE',agencia:'0001',conta:'123456-7'};
if(!process.env.GEMINI_API_KEY||!process.env.DOCUMENT_VISION_MODEL){
 console.error('Teste não executado: configure GEMINI_API_KEY e DOCUMENT_VISION_MODEL no servidor. Nenhum arquivo foi enviado.');process.exitCode=1;
}else{
 const labels={razaoSocial:'Razao social',nomeFantasia:'Nome fantasia',cidade:'Cidade',agencia:'Agencia',conta:'Conta'};
 const rows=Object.entries(expected).map(([key,value],i)=>`<text x="40" y="${120+i*65}" font-size="26">${labels[key as keyof typeof labels]}: ${value}</text>`).join('');
 const bytes=await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="500"><rect width="100%" height="100%" fill="white"/><g fill="black" font-family="sans-serif"><text x="40" y="50" font-size="28">DOCUMENTO FICTICIO - SEM DADOS REAIS</text>${rows}</g></svg>`)).png().toBuffer();
 const result=await readWithVision(bytes,'synthetic.png','',Object.keys(expected),fetch,{...process.env,DOCUMENT_VISION_ENABLED:'true',DOCUMENT_VISION_PROVIDER:'gemini'},true);
 const compact=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
 const correct=Object.entries(expected).filter(([key,value])=>result?.observations.some(o=>o.key===key&&compact(o.value)===compact(value))).length;
 console.log(JSON.stringify({status:result?.status,fixture:'synthetic-only',correct,total:Object.keys(expected).length,productionDocumentsSent:0,message:result?.message},null,2));
 if(result?.status!=='completed'||correct!==Object.keys(expected).length)process.exitCode=1;
}
