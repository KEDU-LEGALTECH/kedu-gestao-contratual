import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fieldExcerpt,proposedChanges,readingGuidance} from '../server/reading-guidance.js';
import {validReadingRegion,readProcessingFile} from '../server/file-reading.js';
import {readingImage,readingPdf} from './reading-fixtures.js';
test('trecho identifica CNPJ com pontuação diferente sem inventar origem',()=>{
 assert.match(fieldExcerpt('Empresa\nCNPJ: 00.817.900/0001-26.\nFim',['00817900000126']),/CNPJ/);
 assert.equal(fieldExcerpt('Sem dados',['Ausente']),'');
});
test('minuta e proposta permanecem separadas e sem aprovação implícita',()=>{
 const [change]=proposedChanges('Minuta: Taxa de 4,50% e R$ 100,00.\nRedação proposta: Taxa de 4,58% e R$ 200,00.\nFundamento: negociação');
 assert.deepEqual(change.originalValues.percentuais,['4,50%']);assert.deepEqual(change.proposedValues.percentuais,['4,58%']);
 assert.match(change.approval,/não informada/);assert.equal(proposedChanges('Taxa: 4,50%').length,0);
});
test('orientações distinguem valores ambíguos, fórmulas e leitura incompleta',()=>{
 assert.match(readingGuidance({fields:{cnpj:['111','222']}},'document'),/Mais de um valor/);
 assert.match(readingGuidance({formulaCount:4},'document'),/4 fórmulas/);
 assert.match(readingGuidance({incomplete:true},'document'),/parcial/);
});
test('regiões inválidas e formatos incompatíveis não acionam OCR',async()=>{
 const valid={page:1,x:0,y:0,width:1,height:1,rotation:0};
 assert.equal(validReadingRegion(valid),true);
 for(const region of [{...valid,x:.8},{...valid,page:31},{...valid,rotation:45},{...valid,width:NaN},{...valid,height:0}])assert.equal(validReadingRegion(region),false);
 assert.match((await readProcessingFile(Buffer.from('doc'),'arquivo.docx',valid)).problem,/região válida/);
});
test('OCR de região lê imagem e página PDF sem modificar o original',async()=>{
 const region={page:1,x:0,y:0,width:1,height:.5,rotation:0};
 const bytes=readingImage().toBuffer('image/png'),original=Buffer.from(bytes);
 const read=await readProcessingFile(bytes,'contrato.png',region);
 assert.equal(read.problem,'');assert.match(read.text,/11[.,]444[.,]777/);assert.equal(read.needsReview,true);assert.deepEqual(bytes,original);
 const pdf=await readProcessingFile(readingPdf(),'contrato.pdf',{...region,height:.3});
 assert.equal(pdf.problem,'');assert.match(pdf.text,/444/);
 const missing=await readProcessingFile(readingPdf(),'contrato.pdf',{...region,page:2});assert.match(missing.problem,/Página indisponível/);
});
