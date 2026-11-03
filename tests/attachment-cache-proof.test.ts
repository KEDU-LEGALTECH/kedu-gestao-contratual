import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {matchesImportedAttachment} from '../server/attachment-cache-proof.js';
test('version reuse requires current document checksum and exact original bytes',()=>{
 const bytes=Buffer.from('documento original'),sha=createHash('sha1').update(bytes).digest('hex');
 assert.equal(matchesImportedAttachment(bytes,sha),true);
 assert.equal(matchesImportedAttachment(Buffer.from('documento alterado'),sha),false);
 assert.equal(matchesImportedAttachment(bytes,undefined),false);
 assert.equal(matchesImportedAttachment(bytes,'documento.pdf'),false);
 assert.equal(matchesImportedAttachment(Buffer.alloc(0),sha),false);
});
