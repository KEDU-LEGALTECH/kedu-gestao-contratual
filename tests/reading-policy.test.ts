import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attachmentRole,fieldsForRole,interruptedReading,automaticReadingCheck} from '../server/reading-policy.js';
test('contraproposta e documentos de apoio não fornecem condições comerciais como contrato',()=>{
 const fields={cnpj:['11.444.777/0001-61'],valor:['9000,00'],agencia:['1234'],remuneracao:['4,50%']};
 assert.equal(attachmentRole('anexo.docx','CONTRAPROPOSTA AO CONTRATO'),'counterproposal');
 assert.deepEqual(fieldsForRole('counterproposal',fields),{});
 assert.deepEqual(fieldsForRole('report',fields),{});
 assert.deepEqual(fieldsForRole('registration',fields),{cnpj:fields.cnpj});
 assert.deepEqual(fieldsForRole('bank',fields),{agencia:fields.agencia});
 assert.deepEqual(fieldsForRole('document',fields),fields);
 assert.equal(attachmentRole('LUMO EDUCACAO - CARTÃO CNPJ.pdf'),'registration');
});
test('OCR exige pessoa para percentuais e nomes mesmo com consenso entre leituras',()=>{
 const reference={cnpj:['11.444.777/0001-61'],remuneracao:['11,84%']};
 const reading={text:'Dados identificados',method:'OCR de imagem',fields:reference,verifiedFields:['cnpj','remuneracao']};
 assert.equal(automaticReadingCheck(reading,'document',reference),false);
 assert.equal(automaticReadingCheck({...reading,verifiedFields:[]},'document',reference),false);
 assert.equal(automaticReadingCheck({...reading,incomplete:true},'document',reference),false);
 assert.equal(automaticReadingCheck({...reading,fields:{...reference,remuneracao:['11,00%']}},'document',reference),false);
 assert.equal(automaticReadingCheck(reading,'document',{...reference,razaoSocial:['Outra instituição']}),false);
 assert.equal(automaticReadingCheck(reading,'simulation',reference),false);
 assert.equal(automaticReadingCheck(reading,'counterproposal',reference),false);
});
test('XLSX literal completo dispensa revisão de leitura; fórmulas ou truncamento não',()=>{
 const reading={text:'CNPJ: 11.444.777/0001-61',method:'XLSX',fields:{cnpj:['11.444.777/0001-61']},formulaCount:0};
 assert.equal(automaticReadingCheck(reading,'document',{}),true);
 assert.equal(automaticReadingCheck({...reading,formulaCount:1},'document',{}),false);
 assert.equal(automaticReadingCheck({...reading,incomplete:true},'document',{}),false);
 assert.equal(automaticReadingCheck({...reading,text:''},'document',{}),false);
});
test('PDF misto só dispensa leitura manual quando todos os campos utilizados existem na camada digital',()=>{
 const fields={cnpj:['11.444.777/0001-61'],remuneracao:['11,84%']};
 const reading={text:'Texto digital e OCR',method:'PDF com OCR',fields,digitalFields:fields};
 assert.equal(automaticReadingCheck(reading,'document',{}),true);
 assert.equal(automaticReadingCheck({...reading,digitalFields:{cnpj:fields.cnpj}},'document',{}),false);
 assert.equal(automaticReadingCheck({...reading,incomplete:true},'document',{}),false);
 assert.equal(automaticReadingCheck({...reading,fields:{...fields,remuneracao:['10,00%']}},'document',{}),false);
});
test('interrupção preserva texto e campos sem aprovar uma leitura parcial',()=>{
 const original={text:'CNPJ: 11.444.777/0001-61',fields:{cnpj:['11.444.777/0001-61']},needsReview:false};
 const partial=interruptedReading(original,'Restam páginas.');
 assert.deepEqual(partial.fields,original.fields);assert.equal(partial.text,original.text);assert.equal(partial.needsReview,true);
 assert.equal((partial as any).incomplete,true);assert.deepEqual(original.needsReview,false);
});
test('componentes de endereço verificados podem conferir com endereço completo explícito',()=>{
 const fields={endereco:['AV CANADA, 49A, JACINTINHO'],rua:['AV CANADA'],numero:['49A'],bairro:['JACINTINHO']};
 const read={text:'Documento cadastral',method:'OCR de imagem',fields,verifiedFields:Object.keys(fields)};
 assert.equal(automaticReadingCheck(read,'registration',{endereco:['Avenida Canada, 49A, Jacintinho']}),false);
 assert.equal(automaticReadingCheck(read,'registration',{endereco:['Avenida Canada, 50, Jacintinho']}),false);
 assert.equal(automaticReadingCheck({...read,verifiedFields:['endereco']},'registration',{endereco:['Avenida Canada, 49A, Jacintinho']}),false);
});
