import {test} from 'node:test';
import assert from 'node:assert/strict';
import {needsPdfOcr} from '../server/pdf-reading-policy.js';
test('digital PDF with small decorative images stays digital; scanned body requires OCR',()=>{
 const codes={save:1,restore:2,transform:3,paintImageXObject:4};
 const text='Texto digital do contrato com informações. '.repeat(20);
 const ops=(scale:number)=>({fnArray:[1,3,4,2],argsArray:[[],[scale,0,0,scale,0,0],[],[]]});
 assert.equal(needsPdfOcr(text,ops(50),codes,600*800),false);
 assert.equal(needsPdfOcr(text,ops(600),codes,600*800),true);
 assert.equal(needsPdfOcr('Cabeçalho',ops(50),codes,600*800),true);
 assert.equal(needsPdfOcr(text,{fnArray:[3],argsArray:[[NaN]]},codes,600*800),true);
});
