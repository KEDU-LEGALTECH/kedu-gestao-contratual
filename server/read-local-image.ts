import {readFileSync, realpathSync, mkdirSync, writeFileSync} from 'node:fs';
import {resolve, relative, isAbsolute} from 'node:path';
import {readLocalDocument} from './local-document-vision.js';

// A deterministic document-reading entry point: no agent, URLs or web tools.
async function main(){
 const input=process.argv[2];
 if(!input)throw Error('Informe o caminho de uma imagem do projeto.');
 const root=realpathSync(process.cwd());
 const path=realpathSync(resolve(input));
 const rel=relative(root,path);
 if(rel==='..'||rel.startsWith('..\\')||rel.startsWith('../')||isAbsolute(rel))throw Error('Escolha um arquivo dentro da pasta do projeto.');
 const fields=(process.argv[3]||'cnpj,razaoSocial,nomeFantasia').split(',');
 console.log('Lendo a imagem local. Nenhum arquivo original ou demanda sera alterado.');
 const result=await readLocalDocument(readFileSync(path),fields);
 console.table(fields.map(field=>{
  const item=result.observations.find(o=>o.field===field);
  return {campo:field,valor:item?.value||'Não localizado',trecho:item?.excerpt||'Sem evidência'};
 }));
 for(const warning of result.warnings)console.log('Conferir: '+warning);
 mkdirSync('data/local-vision-tests',{recursive:true});
 const report='data/local-vision-tests/direct-'+Date.now()+'.json';
 writeFileSync(report,JSON.stringify({file:path,...result,databaseModified:false},null,2));
 console.log('Relatorio: '+report);
}
main().catch(error=>{
 mkdirSync('data/local-vision-tests',{recursive:true});
 const report='data/local-vision-tests/direct-failure-'+Date.now()+'.json';
 writeFileSync(report,JSON.stringify({success:false,error:error.message,unvalidatedObservations:error.observations||[],automaticApproval:false,databaseModified:false},null,2));
 console.error('Leitura nao concluida: '+error.message);
 if(Array.isArray(error.observations)&&error.observations.length){
  console.log('Valores sugeridos pelo modelo — NAO VALIDADOS:');
  console.table(error.observations.map((o:any)=>({campo:o.field,valorSugerido:o.value,trechoInformado:o.excerpt,situacao:'Não confirmado: evidência inconsistente'})));
 }
 console.error('Nenhum dado aprovado. Diagnostico: '+report);
 process.exitCode=1;
});
