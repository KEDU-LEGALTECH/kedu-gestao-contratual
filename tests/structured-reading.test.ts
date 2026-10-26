import {test} from 'node:test';
import assert from 'node:assert/strict';
import PizZip from 'pizzip';
import {demoTemplate} from '../server/documents.js';
import {fieldsFromRows,extractProcessingFile} from '../server/processing-extract.js';
import {positionedRows} from '../server/table-reading.js';
import {extractContractParties,selectContractParty,scopePartyReading} from '../server/contract-parties.js';
test('colunas de cabeçalho e valores são associadas pela posição, sem consumir o próximo rótulo',()=>{
 const items=[{str:'Razão social',transform:[10,0,0,10,220,700],width:100},{str:'CNPJ',transform:[10,0,0,10,10,700],width:50},{str:'ESCOLA TESTE',transform:[10,0,0,10,220,680],width:100},{str:'11.444.777/0001-61',transform:[10,0,0,10,10,680],width:130}];
 assert.deepEqual(fieldsFromRows(positionedRows(items)),{cnpj:['11.444.777/0001-61'],razaoSocial:['ESCOLA TESTE']});
 assert.deepEqual(fieldsFromRows([['CNPJ','Razão social']]),{});
 assert.deepEqual(fieldsFromRows([['Taxa de remuneração','11,84%','Agência','0001']]),{remuneracao:['11,84%'],agencia:['0001']});
});
test('DOCX mantém as fronteiras das células e lê cabeçalhos seguidos de valores',()=>{
 const zip=new PizZip(demoTemplate()),cell=(text:string)=>`<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
 zip.file('word/document.xml',`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl><w:tr>${cell('CNPJ')}${cell('Razão social')}</w:tr><w:tr>${cell('11.444.777/0001-61')}${cell('ESCOLA TESTE')}</w:tr></w:tbl></w:body></w:document>`);
 const reading=extractProcessingFile(zip.generate({type:'nodebuffer'}),'tabela.docx');
 assert.equal(reading.problem,'');assert.deepEqual(reading.fields.cnpj,['11.444.777/0001-61']);assert.deepEqual(reading.fields.razaoSocial,['ESCOLA TESTE']);
});
const text='CONTRATANTE:\nNOME: KEDU SERVICOS LTDA\nCNPJ: 45.543.580/0001-00\nCONTRATADA:\nRAZÃO SOCIAL: ESCOLA TESTE LTDA\nCNPJ: 11.444.777/0001-61\n';
test('CNPJ e nome da Kedu não se misturam com os da contraparte',()=>{
 const parties=extractContractParties(text);assert.equal(parties.length,2);
 assert.equal(selectContractParty(parties,'11.444.777/0001-61')?.name,'ESCOLA TESTE LTDA');
 const scoped=scopePartyReading({text,fields:{cnpj:parties.map(p=>p.cnpj),valor:['1000,00']}},'11.444.777/0001-61');
 assert.deepEqual(scoped.reading.fields.cnpj,['11.444.777/0001-61']);assert.deepEqual(scoped.reading.fields.razaoSocial,['ESCOLA TESTE LTDA']);assert.deepEqual(scoped.reading.fields.valor,['1000,00']);
 assert.equal(selectContractParty(parties,'00.000.000/0001-00')?.cnpj,'11.444.777/0001-61','CNPJ divergente do original é preservado, não copiado do pedido');
});
test('partes ambíguas e menções no corpo não são escolhidas automaticamente',()=>{
 assert.deepEqual(extractContractParties('A CONTRATANTE enviará CNPJ: 11.444.777/0001-61'),[]);
 const parties=extractContractParties(text+'CEDENTE:\nNOME: OUTRA EMPRESA\nCNPJ: 22.222.222/0001-22\n');
 assert.equal(selectContractParty(parties,'99.999.999/0001-99'),null);
 const scoped=scopePartyReading({text:text+'CEDENTE:\nNOME: OUTRA EMPRESA\nCNPJ: 22.222.222/0001-22\n',fields:{cnpj:['45.543.580/0001-00']}},'99.999.999/0001-99');
 assert.equal(scoped.reading.fields.cnpj,undefined);
});
