import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {comparisonSources} from '../server/comparison-sources.js';
import {FieldEvidence,evidenceParts} from '../src/FieldEvidence.js';
test('evidência vem do valor lido no arquivo, sem usar o esperado do GLPI como origem',()=>{
 const files=[{id:'a',name:'Contrato.pdf',available:true,fieldReviews:[{key:'razaoSocial',values:['ESCOLA A LTDA'],observations:[{value:'ESCOLA A LTDA',page:3,excerpt:'Contratada: ESCOLA A LTDA'}]}]}];
 assert.deepEqual(comparisonSources({field:'razaoSocial',expected:'ESCOLA A LTDA'},files),[]);
 assert.deepEqual(comparisonSources({field:'razaoSocial',found:'ESCOLA B LTDA',expected:'ESCOLA A LTDA'},files),[]);
 const sources=comparisonSources({field:'razaoSocial',found:'ESCOLA A LTDA'},files);
 assert.equal(sources[0].page,3);assert.equal(sources[0].fileId,'a');assert.match(sources[0].excerpt,/Contratada/);
});
test('destaque preserva pontuação e acentos do trecho e escapa HTML de anexos',()=>{
 const parts=evidenceParts('CNPJ: 00.817.900/0001-26.','00817900000126');
 assert.equal(parts.filter(p=>p.marked)[0].text,'00.817.900/0001-26');
 assert.equal(evidenceParts('Cidade: ITAGUAÍ','Itaguai').find(p=>p.marked)?.text,'ITAGUAÍ');
 const html=renderToStaticMarkup(React.createElement(FieldEvidence,{did:'KD-1',found:'Itaguai',evidence:[{fileId:'a',fileName:'<script>.pdf',page:2,value:'Itaguai',excerpt:'Cidade: ITAGUAÍ <script>',available:true}]}));
 assert.ok(!html.includes('<script>'));assert.match(html,/<mark>ITAGUAÍ<\/mark>/);assert.match(html,/#page=2/);
});
test('múltiplos valores preservam páginas distintas e ausência de evidência fica explícita',()=>{
 const file={id:'a',name:'Contrato.pdf',fieldReviews:[{key:'conta',values:['12345-6','98765-4'],observations:[{value:'12345-6',page:2,excerpt:'Conta 12345-6'},{value:'98765-4',page:5,excerpt:'Conta 98765-4'}]}]};
 const sources=comparisonSources({field:'conta',found:'123456; 987654'},[file]);
 assert.deepEqual(sources.map(s=>s.page),[2,5]);
 const html=renderToStaticMarkup(React.createElement(FieldEvidence,{found:'Valor lido'}));
 assert.match(html,/ainda não localizados/);
});
