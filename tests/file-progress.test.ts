import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileProgress} from '../server/file-progress.js';
const doc={id:'7',name:'Contrato.pdf'};
const good={byteLength:100,problem:'',extracted:JSON.stringify({text:'Texto lido',fields:{cnpj:['11.444.777/0001-61']},pages:3,needsReview:true})};
test('leitura concluída é independente da aprovação e páginas digitais completas não aparecem como zero',()=>{
 const f=fileProgress(doc,good,{state:'done'},undefined);
 assert.equal(f.state,'completed');assert.equal(f.completedPages,3);
 assert.match(f.detail,/separada/);
});
test('tentativa agendada é contada uma vez e indica data, sem confundir com falha definitiva',()=>{
 const broken={byteLength:0,extracted:'{}',problem:'Falha ao baixar'};
 const retry=fileProgress(doc,broken,{state:'retry',available_at:Date.UTC(2026,10,3,16)},undefined);
 assert.equal(retry.state,'queued');assert.ok(retry.nextAttempt);
 assert.equal(fileProgress(doc,broken,{state:'exhausted'},undefined).state,'failed');
 assert.equal(fileProgress(doc,undefined,undefined,undefined).state,'waiting');
});
test('somente o arquivo ativo fica em leitura, inclusive em releitura direcionada',()=>{
 const active={documentId:'7',targeted:true,page:2};
 assert.equal(fileProgress(doc,good,{state:'running'},active,true).state,'running');
 assert.equal(fileProgress(doc,good,{state:'running'},active,true).page,2);
 assert.equal(fileProgress({id:'8'},good,{state:'running'},active).state,'completed');
 assert.equal(fileProgress(doc,good,{state:'queued'},undefined,true).state,'queued');
});
