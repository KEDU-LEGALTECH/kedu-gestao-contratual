import 'dotenv/config';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {readLocalDocument} from './local-document-vision.js';

const fileId=process.argv[2];
if(!fileId){console.error('Uso: npx tsx server/test-local-document.ts ID_DO_ARQUIVO [campo1,campo2]');process.exitCode=1;}
else{
 const db=new DatabaseSync(process.env.DATABASE_PATH||'data/kedu.sqlite',{readOnly:true});
 const file=db.prepare('SELECT id,name,bytes,extracted FROM processing_files WHERE id=?').get(fileId) as any;db.close();
 if(!file?.bytes?.length||!/\.(png|jpe?g|webp|tiff?|bmp|gif)$/i.test(file.name))throw Error('Escolha um anexo de imagem disponível no projeto.');
 const fields=(process.argv[3]||'cnpj,razaoSocial,nomeFantasia,endereco,cep,cidade,estado').split(',');
 console.log('Leitura local de um anexo; nenhuma alteração nas demandas.');
 const reading=await readLocalDocument(Buffer.from(file.bytes),fields);
 const baseline=JSON.parse(file.extracted).fields||{};
 const report={fileId,name:file.name,created:new Date().toISOString(),...reading,baseline:Object.fromEntries(fields.map(f=>[f,baseline[f]||[]])),productionDocumentsSentToCloud:0,databaseModified:false};
 mkdirSync('data/local-vision-tests',{recursive:true});const path=join('data/local-vision-tests',fileId+'.json');writeFileSync(path,JSON.stringify(report,null,2));
 console.log(JSON.stringify({model:reading.model,fieldsFound:reading.observations.length,elapsedSeconds:Math.round(reading.elapsedMs/1000),report:path,automaticApproval:false,databaseModified:false},null,2));
}
