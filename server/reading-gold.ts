import { one, run, id, now, sql } from './db.js';
import {sha256} from './official-templates.js';
/** Only observations explicitly checked against the original; GLPI expectations are never gold. */
export async function recordReadingGold(fileId:string,field:string,value:string,extractionHash:string,author:string,evidence:string) {
 const file=await sql.one('SELECT bytes FROM processing_files WHERE id=?', fileId);
 if(!file?.bytes?.length)throw Error('Original indisponível para o gabarito.');
 await sql.run('INSERT INTO reading_gold_fields VALUES(?,?,?,?,?,?,?,?,?)', id(), sha256(Buffer.from(file.bytes)), fileId, field, value, extractionHash, evidence, author, now());
}
