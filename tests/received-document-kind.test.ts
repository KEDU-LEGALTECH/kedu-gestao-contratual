import {test} from 'node:test';
import assert from 'node:assert/strict';
import {receivedDocumentKind} from '../shared/document-heading.js';
test('attachment kind identifies counterproposal independently of requested contract',()=>{
 assert.equal(receivedDocumentKind('Contraproposta – Contrato kedu – Colégio São Mateus (1).docx'),'Contraproposta');
 assert.equal(receivedDocumentKind('anexo.docx','CONTRAPROPOSTA AO CONTRATO DE GESTÃO\nContrato de garantia'),'Contraproposta');
 assert.equal(receivedDocumentKind('anexo.png'),'Tipo a identificar');
 assert.equal(receivedDocumentKind('Contrato educacional.docx'),'Contrato educacional');
});
