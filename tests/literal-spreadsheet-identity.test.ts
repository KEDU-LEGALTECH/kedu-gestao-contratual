import {test} from 'node:test';
import assert from 'node:assert/strict';
import PizZip from 'pizzip';
import {literalSpreadsheetIdentity} from '../server/xlsx-reading.js';
import {hasDigitalField} from '../server/comparison-evidence.js';

function workbook(formula=false,hidden=false){
 const zip=new PizZip();
 zip.file('xl/workbook.xml',`<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Cadastro" sheetId="1" r:id="rId1" ${hidden?'state="hidden"':''}/></sheets></workbook>`);
 zip.file('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>');
 const value=formula?'<f>CONCAT(11,444777000161)</f><v>11444777000161</v>':'<is><t>11.444.777/0001-61</t></is>';
 zip.file('xl/worksheets/sheet1.xml',`<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>CNPJ</t></is></c><c r="B1" ${formula?'':'t="inlineStr"'}>${value}</c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Valor</t></is></c><c r="B2"><f>2+2</f><v>4</v></c></row></sheetData></worksheet>`);
 return zip;
}
test('literal identity is independent from unrelated formulas and preserves source sheet/quote',()=>{
 const r=literalSpreadsheetIdentity(workbook());
 assert.deepEqual(r.fields.cnpj,['11.444.777/0001-61']);assert.equal(r.origins.cnpj[0].sheet,'Cadastro');assert.match(r.origins.cnpj[0].excerpt,/11\.444\.777\/0001-61/);
 assert.equal(hasDigitalField({method:'XLSX',formulaCount:500,literalIdentityFields:r.fields},'cnpj','11444777000161'),true);
 assert.equal(hasDigitalField({method:'XLSX',formulaCount:500,digitalFields:{valor:['4,00']}},'valor','4,00'),false);
});
test('formula caches and hidden sheets cannot confirm identity',()=>{
 assert.equal(literalSpreadsheetIdentity(workbook(true)).fields.cnpj,undefined);
 assert.deepEqual(literalSpreadsheetIdentity(workbook(false,true)).fields,{});
});
