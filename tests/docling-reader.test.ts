import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readDoclingPage} from '../server/docling-reader.js';
import {targetedReadingTargets,mergeTargetedReading} from '../server/targeted-reading.js';
test('Docling rejeita entrada não PDF e página inválida sem iniciar processamento',async()=>{
 assert.equal((await readDoclingPage(Buffer.from('não é PDF'),1)).ok,false);
 assert.equal((await readDoclingPage(Buffer.from('%PDF-1.7'),0)).ok,false);
});
test('Docling não inicia automaticamente sem ativação explícita',async()=>{
 const previous=process.env.DOCUMENT_DOCLING_ENABLED;process.env.DOCUMENT_DOCLING_ENABLED='false';
 try{assert.match((await readDoclingPage(Buffer.from('%PDF-1.7'),1)).reason||'',/desativada/);}finally{if(previous===undefined)delete process.env.DOCUMENT_DOCLING_ENABLED;else process.env.DOCUMENT_DOCLING_ENABLED=previous;}
});
test('leitor complementar tem tentativa independente e não substitui campo já lido',()=>{
 const reading={text:'CNPJ 11.444.777/0001-61',fields:{cnpj:['11.444.777/0001-61']},pages:1,needsReview:true};
 const pending=[{field:'cnpj',status:'review',source:'Contrato.pdf'}];
 const ocr=targetedReadingTargets('Contrato.pdf',reading,pending)[0];
 const previous=mergeTargetedReading(reading,{problem:'falha'},ocr);
 assert.equal(targetedReadingTargets('Contrato.pdf',previous,pending).length,0);
 const target=targetedReadingTargets('Contrato.pdf',previous,pending,[],'docling')[0];assert.ok(target);
 const next=mergeTargetedReading(previous,{text:'CNPJ 00.817.900/0001-26',fields:{cnpj:['00.817.900/0001-26']}},target);
 assert.deepEqual(next.fields,reading.fields);assert.equal(next.needsReview,true);
});
test('um rótulo armazenado como valor pode ser recuperado sem perder o registro anterior',()=>{
 const previous={text:'CNPJ',fields:{cnpj:['DATA DE ABERTURA']},needsReview:true};
 const next=mergeTargetedReading(previous,{text:'CNPJ: 11.444.777/0001-61',fields:{cnpj:['11.444.777/0001-61']}},{page:1,fields:['cnpj'],signature:'docling'});
 assert.deepEqual(next.fields.cnpj,['11.444.777/0001-61']);assert.deepEqual(next.targetedInvalidValues.cnpj,['DATA DE ABERTURA']);
 assert.equal(next.text,previous.text);assert.equal(next.needsReview,true);
});
test('proveniência nativa só é registrada para saída Docling sem OCR e sem conflito anterior',()=>{
 const previous={text:'Texto original',method:'PDF com OCR',fields:{},needsReview:true};
 const next={method:'Docling — estrutura do PDF',nativeText:true,text:'CNPJ: 11.444.777/0001-61',fields:{cnpj:['11.444.777/0001-61']}};
 const target={page:2,fields:['cnpj'],signature:'native'};
 const result=mergeTargetedReading(previous,next,target);
 assert.deepEqual(result.digitalFields.cnpj,['11.444.777/0001-61']);assert.equal(result.digitalFieldOrigins.cnpj[0].page,2);
 assert.equal(result.needsReview,true,'não confirma o arquivo inteiro');
 const ocr=mergeTargetedReading(previous,{...next,nativeText:false},target);
 assert.equal(ocr.digitalFields,undefined,'OCR não vira texto digital por coincidência');
});
