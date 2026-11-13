import { one, run, id, now, sql } from './db.js';
import {sha256} from './official-templates.js';
import {fileBytes,storedSize} from './processing-files.js';
/** Only observations explicitly checked against the original; GLPI expectations are never gold. */
export async function recordReadingGold(fileId:string,field:string,value:string,extractionHash:string,author:string,evidence:string) {
 const file=await sql.one('SELECT * FROM processing_files WHERE id=?', fileId);
 if(!storedSize(file))throw Error('Original indisponível para o gabarito.');
 await sql.run('INSERT INTO reading_gold_fields VALUES(?,?,?,?,?,?,?,?,?)', id(), sha256(await fileBytes(file)), fileId, field, value, extractionHash, evidence, author, now());
}
