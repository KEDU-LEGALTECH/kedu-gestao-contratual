import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {readingPdf,mixedReadingPdf} from './reading-fixtures.js';
const configPath=resolve('data/docling-runtime.json');

test('tabela com células irregulares preserva rótulo e valor no fallback',t=>{
 if(!existsSync(configPath)){t.skip('Ambiente Docling não instalado');return;}
 const {python}=JSON.parse(readFileSync(configPath,'utf8'));
 const output=execFileSync(python,['-c',`import importlib.util,json
from types import SimpleNamespace as S
spec=importlib.util.spec_from_file_location('worker','server/ocr/docling_worker.py')
worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
class Table:
 def export_to_dataframe(self,doc): raise ValueError('irregular cells')
 data=S(table_cells=[S(start_row_offset_idx=0,start_col_offset_idx=0,text='CNPJ'),S(start_row_offset_idx=0,start_col_offset_idx=1,text='11.444.777/0001-61')])
print(json.dumps(worker.table_rows(Table(),None)))`],{encoding:'utf8',windowsHide:true,timeout:30000});
 assert.deepEqual(JSON.parse(output),[['CNPJ','11.444.777/0001-61']]);
});
test('inventário identifica texto nativo e páginas digitalizadas sem carregar modelos',t=>{
 if(!existsSync(configPath)){t.skip('Ambiente Docling não instalado');return;}
 const python=JSON.parse(readFileSync(configPath,'utf8')).python;
 if(!existsSync(python)){t.skip('Python Docling indisponível');return;}
 const directory=mkdtempSync(join(tmpdir(),'kedu-docling-inventory-'));
 const path=join(directory,'snapshot.sqlite'),db=new DatabaseSync(path);
 db.exec('CREATE TABLE processing_files(id TEXT,bytes BLOB)');
 db.prepare('INSERT INTO processing_files VALUES(?,?)').run('text',readingPdf());
 db.prepare('INSERT INTO processing_files VALUES(?,?)').run('mixed',mixedReadingPdf());db.close();
 const selection=join(directory,'selection.json'),output=join(directory,'inventory.json');
 writeFileSync(selection,JSON.stringify([{id:'text'},{id:'mixed'}]));
 execFileSync(python,[resolve('server/ocr/docling_inventory.py'),path,selection,output],{windowsHide:true,timeout:30000});
 const result=JSON.parse(readFileSync(output,'utf8'));
 assert.equal(result[0].error,undefined);assert.match(result[0].pages[0].text,/11.444.777/);
 assert.equal(result[1].pages[0].text.trim(),'');assert.match(result[1].pages[1].text,/00.817.900/);
});
test('protocolo de lote separa respostas e rejeita PDF digitalizado sem carregar modelos',t=>{
 if(!existsSync(configPath)){t.skip('Ambiente Docling não instalado');return;}
 const config=JSON.parse(readFileSync(configPath,'utf8'));if(!existsSync(config.python)){t.skip('Python indisponível');return;}
 const request=JSON.stringify({bytes:readingPdf(true).toString('base64'),page:1});
 const output=execFileSync(config.python,['-u',resolve('server/ocr/docling_worker.py'),'--persistent'],{windowsHide:true,input:request+'\n'+request+'\n',encoding:'utf8',timeout:30000,env:{...process.env,PYTHONUTF8:'1'}});
 const results=output.trim().split('\n').map(line=>JSON.parse(line));
 assert.equal(results.length,2);for(const r of results){assert.equal(r.text,'');assert.equal(r.nativeText,true);assert.equal(r.error,undefined);}
});
