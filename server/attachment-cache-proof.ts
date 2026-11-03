import {createHash} from 'node:crypto';
/** Current imported GLPI document checksum must match the actual local bytes.
 * Ticket IDs, filenames and unchanged metadata alone are never proof. */
export function matchesImportedAttachment(bytes:Uint8Array,sha1:unknown){
 return !!bytes.length&&typeof sha1==='string'&&/^[a-f0-9]{40}$/i.test(sha1)&&createHash('sha1').update(bytes).digest('hex')===sha1.toLowerCase();
}
