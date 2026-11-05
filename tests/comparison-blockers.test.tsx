import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {test} from 'node:test';import assert from 'node:assert/strict';import {RequestComparison} from '../src/RequestComparison.js';
test('the comparison summary includes structural blockers without listing administrative model checks',()=>{
 const html=renderToStaticMarkup(<RequestComparison rows={[{field:'cnpj',label:'CNPJ',status:'matches',found:'05.868.278/0001-07',expected:'05.868.278/0001-07'}]} issues={[{field:'review:parties:file',label:'Identificação da parte contratual',message:'Confirme a parte no documento.',source:'Contrato.pdf'},{field:'template',label:'Modelo',message:'Aprovar modelo'}]}/>);
 assert.match(html,/1<\/strong> pendente/);assert.match(html,/Identificação da parte contratual/);assert.match(html,/Contrato.pdf/);assert.doesNotMatch(html,/Aprovar modelo/);
});
