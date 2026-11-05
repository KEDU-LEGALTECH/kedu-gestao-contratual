import {test} from 'node:test';import assert from 'node:assert/strict';
import {missingFieldEvidence} from '../server/document-evidence.js';
import {pendingReason} from '../shared/pending-reason.js';
test('an attachment known to be blank is distinct from an absent attachment',()=>{
 const evidence=missingFieldEvidence('cnpj',[{name:'imagem.png',text:'',problem:'Nenhum texto legível',emptyContent:true}]);
 assert.equal(evidence.reason,'empty_source');
 assert.equal(pendingReason({missingReason:evidence.reason})?.label,'Anexo recebido em branco');
 assert.equal(missingFieldEvidence('cnpj',[]).reason,'not_sent');
});
test('blank auxiliary image does not invalidate an existing relevant source',()=>{
 const evidence=missingFieldEvidence('cnpj',[{name:'imagem.png',emptyContent:true,problem:'Nenhum texto legível'},{name:'contrato.pdf',text:'Contrato de prestação de serviços.'}]);
 assert.equal(evidence.reason,'not_located');
 assert.equal(missingFieldEvidence('cnpj',[{name:'imagem.png',downloadPending:true}]).reason,'download_pending');
});
