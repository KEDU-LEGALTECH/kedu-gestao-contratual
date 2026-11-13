import {test,after} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {readingImage} from "./reading-fixtures.js";
import express from "express";
import PizZip from "pizzip";
process.env.DATABASE_PATH=join(mkdtempSync(join(tmpdir(),"kedu-process-")),"test.sqlite");
process.env.NODE_ENV="test";process.env.DEMO_SEED="false";process.env.GLPI_MODE="demo";
const { one, all, run, now, sql } = await import("../server/db.js");
const {registerOfficialCatalog,sha256}=await import("../server/official-templates.js");
const {fileBytes,storedSize}=await import("../server/processing-files.js");
const {demoTemplate,paragraphs}=await import("../server/documents.js");
const {processContract,saveProcessingResult,buildProcessingPlan,ensureProcessing,processingSummary,recoveryReason}=await import("../server/contract-processing.js");
const {registerProcessingRoutes,processingView}=await import("../server/processing-routes.js");
const {inputLabels}=await import("../server/processing-extract.js");
await sql.run("INSERT INTO users VALUES('u','Teste','u@test.local','Administrador','unused')");
await sql.run("INSERT INTO schools VALUES('s','Escola teste','Escola teste','11.444.777/0001-61','','')");
await registerOfficialCatalog();
const template=await sql.one("SELECT v.* FROM template_versions v JOIN template_sources s ON s.version_id=v.id WHERE s.modality='Garantia Completa'");
await sql.run("INSERT INTO template_homologations VALUES(?,?,?,?,?)", template.id, "u", "Homologação simulada para teste", now(), sha256(Buffer.from(template.bytes)));
await sql.run("UPDATE template_versions SET status='aprovado',approved_by='u' WHERE id=?", template.id);
const data={razaoSocial:"Escola teste",nomeFantasia:"Escola teste",cnpj:"11.444.777/0001-61",rua:"Rua Teste",numero:"10",bairro:"Centro",cidade:"Fortaleza",estado:"Estado do Ceará",cep:"60000-000",representanteNome:"Representante Teste",representanteCpf:"529.982.247-25",dataFormalizacao:"2026-10-21",alunos:"100",incorporaMatricula:"Sim",cashbackValor:"0,00",remuneracao:"11,84%",valor:"10000,00",inicio:"2030-01-01",fim:"2031-01-01",duracaoMeses:"12",banco:"Banco teste",conta:"001-2",agencia:"0001",titularConta:"Escola teste",documentoTitular:"11.444.777/0001-61",parcelas:"12",repasse:"88,16%",diaRepasse:"10",modalidade:"Garantia Completa"};
function doc(values:Record<string,string>) {
 const zip=new PizZip(demoTemplate());
 zip.file("word/document.xml",'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+Object.entries(values).map(([k,v])=>'<w:p><w:r><w:t>'+(inputLabels[k]||k)+': '+v.replaceAll('&','&amp;')+'</w:t></w:r></w:p>').join('')+'</w:body></w:document>');
 return zip.generate({type:"nodebuffer"});
}
async function fixture(id:string,extension="docx") {
 const raw={externalId:id,title:"JURIDICO : SOLICITAÇÃO DE CONTRATO PARA ESCOLAS",content:"<p>RAZÃO SOCIAL: Escola teste</p><p>CNPJ: 11.444.777/0001-61</p><p>TAXA DE REMUNERAÇÃO: 11,84%</p>",documents:[{id:"7",name:"Contrato."+extension}],documentsAvailable:true,followups:[],groups:[],status:"2",created:"",updated:"",category:""};
 await sql.run("INSERT INTO demands(id,glpi_id,school_id,type,stage,priority,owner,due,data,created) VALUES(?,?,?,'Contrato de garantia','Recebido','Normal','u','','{}',?)", id, id, "s", now());
 await sql.run("INSERT INTO glpi_tickets VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", id, "real", raw.title, "2", "hash-"+id, JSON.stringify(raw), "{}", "vinculado", id, now(), now(), null);
 return raw;
}
const mock=(values:Record<string,string>=data,name="Contrato.docx")=>async()=>({bytes:doc(values),name,mime:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"});
test('falha transitória de download é recuperada e arquivo inválido continua disponível como original',async()=>{
 await fixture('retry');let attempts=0;
 await processContract('retry','u',async()=>{attempts++;if(attempts===1)throw Error('temporário');return mock()();});
 assert.equal(attempts,2);assert.ok(storedSize(await sql.one('SELECT * FROM processing_files WHERE demand_id=?', 'retry')));
 await fixture('denied');let denied=0;
 await processContract('denied','u',async()=>{denied++;throw Object.assign(Error('sem acesso'),{status:403});});
 assert.equal(denied,1);assert.ok((await buildProcessingPlan('denied'))!.issues.some(i=>i.field==='file:7'));
 await fixture('invalid');await processContract('invalid','u',async()=>({bytes:Buffer.from('arquivo corrompido'),name:'original.docx',mime:'application/octet-stream'}));
 assert.equal((await fileBytes(await sql.one('SELECT * FROM processing_files WHERE demand_id=?', 'invalid'))).toString(),'arquivo corrompido');
});
test('revisão de uma planilha não torna campos de um DOCX independente inconclusivos',async()=>{
 await fixture('scope');await processContract('scope','u',mock());
 await sql.run('INSERT INTO processing_files VALUES(?,?,?,?,?,?,?,?,?,?)', 'scope-sheet', 'scope', '8', 'hash-scope', 'simulacao.xlsx', 'application/octet-stream', Buffer.from('original'), JSON.stringify({version:2,text:'Remuneração: 11,00%',fields:{remuneracao:['11,00%']},needsReview:true,method:'XLSX'}), '', now());
 const plan=(await buildProcessingPlan('scope'))!;
 assert.equal(plan.comparisons.find(r=>r.field==='razaoSocial')?.status,'matches');
 assert.equal(plan.comparisons.find(r=>r.field==='remuneracao')?.status,'review');
 assert.equal(plan.comparisons.find(r=>r.field==='remuneracao')?.readingPending,true);
 assert.ok(plan.issues.some(i=>i.field==='review:scope-sheet'));
});
test('atualizar leitura reprocessa anexo saudável em cache sem baixar ou alterar o original',async()=>{
 await fixture('force-reading');await processContract('force-reading','u',mock());
 const file=await sql.one('SELECT * FROM processing_files WHERE demand_id=?', 'force-reading'),reading=JSON.parse(file.extracted);
 await sql.run('UPDATE processing_files SET extracted=? WHERE id=?', JSON.stringify({...reading,fields:{razaoSocial:['Leitura antiga incorreta']}}), file.id);
 let downloads=0;await processContract('force-reading','u',async()=>{downloads++;throw Error('Não deveria baixar');},true);
 const after=await sql.one('SELECT * FROM processing_files WHERE id=?', file.id);
 assert.equal(downloads,0);assert.deepEqual(JSON.parse(after.extracted).fields.razaoSocial,[data.razaoSocial]);assert.deepEqual(await fileBytes(after),await fileBytes(file));
});

test('nova versão reutiliza leitura saudável somente após confirmar bytes atuais idênticos',async()=>{
 await fixture('identical-original');await processContract('identical-original','u',mock());
 const original=await sql.one('SELECT * FROM processing_files WHERE demand_id=?', 'identical-original');
 const reading={...JSON.parse(original.extracted),reuseMarker:'leitura anterior'};
 await sql.run('UPDATE processing_files SET extracted=? WHERE id=?', JSON.stringify(reading), original.id);
 await sql.run('UPDATE glpi_tickets SET hash=? WHERE external_id=?', 'new-identical', 'identical-original');
 let downloads=0;
 await processContract('identical-original','u',async()=>{downloads++;return {bytes:await fileBytes(original),name:original.name,mime:original.mime};});
 assert.equal(downloads,1);
 const current=await sql.one('SELECT * FROM processing_files WHERE demand_id=? AND ticket_hash=?', 'identical-original', 'new-identical');
 assert.equal(JSON.parse(current.extracted).reuseMarker,'leitura anterior');
 assert.deepEqual(await fileBytes(current),await fileBytes(original));
 await sql.run('UPDATE glpi_tickets SET hash=? WHERE external_id=?', 'new-changed', 'identical-original');
 await processContract('identical-original','u',mock({...data,razaoSocial:'Outra escola'}));
 const changed=await sql.one('SELECT extracted FROM processing_files WHERE demand_id=? AND ticket_hash=?', 'identical-original', 'new-changed');
 assert.equal(JSON.parse(changed.extracted).reuseMarker,undefined);
 assert.deepEqual(JSON.parse(changed.extracted).fields.razaoSocial,['Outra escola']);
});
test('conferência humana acompanha nova versão só com mesmos bytes e mesma extração',async()=>{
 await fixture('keep-review');await processContract('keep-review','u',mock());
 const original=await sql.one('SELECT * FROM processing_files WHERE demand_id=?', 'keep-review');
 const extracted=JSON.stringify({...JSON.parse(original.extracted),needsReview:true,method:'OCR de imagem'});
 await sql.run('UPDATE processing_files SET extracted=? WHERE id=?', extracted, original.id);
 const hash=sha256(Buffer.from(extracted)),when='2026-01-02T03:04:05.000Z';
 assert.ok((await buildProcessingPlan('keep-review'))!.issues.some(i=>i.field==='review:'+original.id));
 await sql.run('INSERT INTO processing_file_reviews VALUES(?,?,?,?)', original.id, hash, 'u', when);
 await sql.run('INSERT INTO processing_field_reviews VALUES(?,?,?,?,?,?)', original.id, 'cnpj', hash, '11.444.777/0001-61', 'u', when);
 const same=async()=>({bytes:await fileBytes(original),name:original.name,mime:original.mime});
 await sql.run('UPDATE glpi_tickets SET hash=? WHERE external_id=?', 'keep-v2', 'keep-review');
 await processContract('keep-review',null,same);
 const kept=await sql.one('SELECT * FROM processing_files WHERE demand_id=? AND ticket_hash=?', 'keep-review', 'keep-v2');
 assert.notEqual(kept.id,original.id);assert.equal(kept.extracted,extracted);
 const whole=await sql.one('SELECT * FROM processing_file_reviews WHERE file_id=?', kept.id),field=await sql.one('SELECT * FROM processing_field_reviews WHERE file_id=?', kept.id);
 assert.deepEqual([whole.extraction_hash,whole.author,whole.created],[hash,'u',when]);
 assert.deepEqual([field.field,field.value,field.author,field.created],['cnpj','11.444.777/0001-61','u',when]);
 assert.ok(await sql.one('SELECT file_id FROM processing_file_reviews WHERE file_id=?', original.id),'a conferência original permanece');
 assert.ok(!(await buildProcessingPlan('keep-review'))!.issues.some(i=>i.field==='review:'+kept.id));
 assert.ok(await sql.one("SELECT id FROM audit WHERE demand_id=? AND action LIKE 'Conferência humana mantida%'", 'keep-review'));
 // Another version without changes in the attachment keeps it again.
 await sql.run('UPDATE glpi_tickets SET hash=? WHERE external_id=?', 'keep-v3', 'keep-review');
 await processContract('keep-review',null,same);
 const again=await sql.one('SELECT id FROM processing_files WHERE demand_id=? AND ticket_hash=?', 'keep-review', 'keep-v3');
 assert.ok(await sql.one('SELECT file_id FROM processing_file_reviews WHERE file_id=?', again.id));
 // Different bytes are another document: no check may follow them.
 await sql.run('UPDATE glpi_tickets SET hash=? WHERE external_id=?', 'keep-v4', 'keep-review');
 await processContract('keep-review',null,mock({...data,razaoSocial:'Outra escola'}));
 const other=await sql.one('SELECT id FROM processing_files WHERE demand_id=? AND ticket_hash=?', 'keep-review', 'keep-v4');
 assert.equal((await sql.one('SELECT count(*) n FROM processing_file_reviews WHERE file_id=?', other.id)).n,0);
 assert.equal((await sql.one('SELECT count(*) n FROM processing_field_reviews WHERE file_id=?', other.id)).n,0);
});
test('sem conferência anterior, a nova versão não cria conferência nem registra sua manutenção',async()=>{
 await fixture('no-review');await processContract('no-review','u',mock());
 const original=await sql.one('SELECT * FROM processing_files WHERE demand_id=?', 'no-review');
 await sql.run('UPDATE glpi_tickets SET hash=? WHERE external_id=?', 'no-review-v2', 'no-review');
 await processContract('no-review',null,async()=>({bytes:await fileBytes(original),name:original.name,mime:original.mime}));
 const current=await sql.one('SELECT id FROM processing_files WHERE demand_id=? AND ticket_hash=?', 'no-review', 'no-review-v2');
 assert.equal((await sql.one('SELECT count(*) n FROM processing_file_reviews WHERE file_id=?', current.id)).n,0);
 assert.equal((await sql.one('SELECT count(*) n FROM processing_field_reviews WHERE file_id=?', current.id)).n,0);
 assert.equal((await sql.one("SELECT count(*) n FROM audit WHERE demand_id=? AND action LIKE 'Conferência humana mantida%'", 'no-review')).n,0);
});
test('comprovante com dado confirmado em contrato digital dispensa revisão duplicada; divergência não',async()=>{
 await fixture('corroborated');await processContract('corroborated','u',mock());
 const extracted={version:2,text:'Dados bancários',fields:{agencia:['0001']},needsReview:true,method:'OCR de imagem'};
 await sql.run('INSERT INTO processing_files VALUES(?,?,?,?,?,?,?,?,?,?)', 'bank-support', 'corroborated', '8', 'hash-corroborated', 'Comprovante bancario.png', 'image/png', Buffer.from('original'), JSON.stringify(extracted), '', now());
 assert.equal((await buildProcessingPlan('corroborated'))!.issues.some(i=>i.field==='review:bank-support'),false);
 const source=await sql.one('SELECT * FROM processing_files WHERE demand_id=? AND id<>?', 'corroborated', 'bank-support');
 await sql.run('UPDATE processing_files SET extracted=? WHERE id=?', JSON.stringify({...JSON.parse(source.extracted),method:'PDF com OCR',needsReview:true,incomplete:true,digitalFields:{agencia:['0001']}}), source.id);
 const mixed=(await buildProcessingPlan('corroborated'))!;
 assert.equal(mixed.issues.some(i=>i.field==='review:bank-support'),false,'campo digital independente evita confirmação duplicada');
 assert.ok(mixed.issues.some(i=>i.field==='review:partial:'+source.id),'outra página parcial continua pendente');
 extracted.fields.agencia=['0002'];await sql.run('UPDATE processing_files SET extracted=? WHERE id=?', JSON.stringify(extracted), 'bank-support');
 assert.ok((await buildProcessingPlan('corroborated'))!.issues.some(i=>i.field==='review:bank-support'));
 assert.ok((await buildProcessingPlan('corroborated'))!.issues.some(i=>i.field==='agencia'));
});
test('divergência digital comprovada aparece como correção mesmo com outra leitura pendente',async()=>{
 await fixture('known-difference');await processContract('known-difference','u',mock({...data,remuneracao:'9,00%'}));
 await sql.run('INSERT INTO processing_files VALUES(?,?,?,?,?,?,?,?,?,?)', 'unrelated', 'known-difference', '8', 'hash-known-difference', 'apoio.xlsx', 'application/octet-stream', Buffer.from('original'), JSON.stringify({version:2,text:'Garantia: 95,00%',fields:{garantia:['95,00%']},needsReview:true,method:'XLSX'}), '', now());
 const result=(await saveProcessingResult('known-difference'))!;
 assert.equal(result.status,'Aguardando correção');assert.ok(result.issues.some(i=>i.field==='review:unrelated'));
 assert.ok(result.issues.length,'o download permanece bloqueado');
});
test('relatório de apoio não fornece condições comerciais nem substitui contrato ausente',async()=>{
 await fixture('report-only');await processContract('report-only','u',mock());
 const file=await sql.one('SELECT * FROM processing_files WHERE demand_id=?', 'report-only');
 await sql.run('UPDATE processing_files SET name=?,extracted=? WHERE id=?', 'RELATÓRIO DESCREDENCIAMENTO.xlsx', JSON.stringify({...JSON.parse(file.extracted),method:'XLSX',formulaCount:10,needsReview:true}), file.id);
 const plan=(await saveProcessingResult('report-only'))!;
 assert.ok(plan.issues.some(i=>i.field==='contractMissing'));
 assert.equal(plan.issues.some(i=>i.field==='review:'+file.id),false);
 assert.equal(plan.origins.rua,undefined);
 assert.equal(plan.status,'Conferência parcial');
});
test('comparação usa a parte do chamado em vez de misturar CNPJ da Kedu e da contratada',async()=>{
 await fixture('party-comparison');
 const zip=new PizZip(doc(data));const xml=zip.file('word/document.xml')!.asText();
 const declarations=['CONTRATANTE:','NOME: KEDU SERVICOS LTDA','CNPJ: 45.543.580/0001-00','CONTRATADA:','NOME: Escola teste','CNPJ: 11.444.777/0001-61'].map(text=>`<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join('');
 zip.file('word/document.xml',xml.replace('</w:body>',declarations+'</w:body>'));
 await processContract('party-comparison','u',async()=>({bytes:zip.generate({type:'nodebuffer'}),name:'partes.docx',mime:'application/octet-stream'}));
 const plan=(await buildProcessingPlan('party-comparison'))!;
 assert.equal(plan.comparisons.find(r=>r.field==='cnpj')?.found,'11.444.777/0001-61');
 assert.equal(plan.files[0].parties.length,2);assert.equal(plan.files[0].selectedParty?.role,'CONTRATADA');
 assert.equal(plan.issues.some(i=>i.field==='cnpj'),false);
});
const app=express();app.use(express.json());app.use((req:any,_res,next)=>{req.user={id:"u",role:req.headers["x-role"]||"Administrador"};next();});
registerProcessingRoutes(app);app.use((err:any,_req:any,res:any,_next:any)=>res.status(err.status||400).json({error:err.message}));
// Slow tests leave fetch keep-alive sockets idle past the 5 s default; the server must not close them first.
const server=app.listen(0,"127.0.0.1");server.keepAliveTimeout=120000;await new Promise<void>(resolve=>server.on("listening",resolve));after(()=>server.close());
const base=`http://127.0.0.1:${(server.address() as any).port}/api/demands`;
async function completed(did:string){const result=await processingView(did);assert.ok(result && "template" in result,"A análise deve ter terminado");return result;}

test('campo sustentado por fonte confiável não herda dúvida de outra leitura concordante',async()=>{
 await fixture('trusted-field');await processContract('trusted-field','u',mock());
 await sql.run('INSERT INTO processing_files VALUES(?,?,?,?,?,?,?,?,?,?)', 'trusted-field-weak', 'trusted-field', 'extra', 'hash-trusted-field', 'foto.pdf', 'application/pdf', Buffer.from('original'), JSON.stringify({version:4,text:'Razão social: Escola teste',fields:{razaoSocial:['Escola teste']},needsReview:true,method:'PDF com OCR',confidence:40}), '', now());
 let plan=(await buildProcessingPlan('trusted-field'))!;
 assert.equal(plan.comparisons.find(c=>c.field==='razaoSocial')?.status,'matches');
 assert.equal(plan.comparisons.find(c=>c.field==='razaoSocial')?.readingPending,false);
 // Another reliable source confirms the value; the weak OCR itself was not approved.
 assert.ok(plan.issues.some(i=>i.field==='review:trusted-field-weak'));
 await sql.run('UPDATE processing_files SET extracted=? WHERE id=?', JSON.stringify({version:4,text:'Razão social: Outra escola',fields:{razaoSocial:['Outra escola']},needsReview:true,method:'PDF com OCR',confidence:40}), 'trusted-field-weak');
 plan=(await buildProcessingPlan('trusted-field'))!;
 assert.notEqual(plan.comparisons.find(c=>c.field==='razaoSocial')?.status,'matches');
});

test('conferência e correção de leitura alimentam gabarito do original, nunca o valor esperado no GLPI',async()=>{
 await fixture('human-gold');await processContract('human-gold','u',mock({...data,remuneracao:'11,00%'}));
 let result=await completed('human-gold');const file=result.files[0];
 const original=await fileBytes(await sql.one('SELECT * FROM processing_files WHERE id=?', file.id));
 let response=await fetch(base+`/human-gold/processing/files/${file.id}/fields/remuneracao/confirm`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:result.revision,value:'11,00%',confirmed:true})});
 assert.equal(response.status,200);assert.equal((await sql.one('SELECT value FROM reading_gold_fields WHERE file_id=?', file.id)).value,'11,00%');
 result=await response.json();
 response=await fetch(base+`/human-gold/processing/files/${file.id}/fields/razaoSocial/correct-reading`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:result.revision,value:'Escola teste',evidence:'Razão social: Escola teste',confirmed:true})});
 assert.equal(response.status,200,await response.clone().text());
 assert.equal((await sql.one('SELECT value FROM reading_gold_fields WHERE file_id=? AND field=?', file.id, 'razaoSocial')).value,'Escola teste');
 assert.deepEqual(await fileBytes(await sql.one('SELECT * FROM processing_files WHERE id=?', file.id)),original);
 const count=(await sql.one('SELECT COUNT(*) n FROM reading_gold_fields')).n;
 response=await fetch(base+`/human-gold/processing/files/${file.id}/fields/razaoSocial/correct-reading`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:result.revision,value:'Inventado',evidence:'Não consta no original',confirmed:true})});
 assert.equal(response.status,400);assert.equal((await sql.one('SELECT COUNT(*) n FROM reading_gold_fields')).n,count);
});

test('lista corrige etapa antiga de correção quando a comparação só tem leituras inconclusivas',async()=>{
 await fixture('stale-stage');await processContract('stale-stage','u',mock({}));
 const result=await completed('stale-stage');
 assert.equal(result.status,'Aguardando análise');
 assert.ok(result.comparisons.some(c=>c.status==='missing'));
 assert.ok(!result.comparisons.some(c=>c.status==='different'));
 await sql.run("UPDATE contract_processing SET status='Aguardando correção' WHERE demand_id='stale-stage'");
 assert.equal((await processingSummary('stale-stage'))?.status,'Aguardando análise');
 assert.equal((await sql.one("SELECT status FROM contract_processing WHERE demand_id='stale-stage'")).status,'Aguardando análise');
});
test("Leitura automática identifica dados e modelo e libera download sem formulário manual quando tudo está correto",async()=>{
 await fixture("good");await processContract("good","u",mock() as any);
 const result=await completed("good");assert.equal(result.status,"Sem erros",JSON.stringify(result.issues));
 assert.equal(result.template.modality,"Garantia Completa");assert.equal(result.values.remuneracao,"11,84%");
 const response=await fetch(base+"/good/processing/export",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({revision:result.revision})});
 assert.equal(response.status,200,await response.clone().text());const output=await response.json();
 const file=await fetch(`http://127.0.0.1:${(server.address() as any).port}`+output.url);assert.equal(file.status,200);
 const bytes=Buffer.from(await file.arrayBuffer());const text=paragraphs(bytes).join(" ");assert.match(text,/11,84%/);assert.match(text,/Escola teste/);
 assert.equal((await sql.one("SELECT confirmed FROM demands WHERE id='good'")).confirmed,0,"download não declara conferência humana ou assinatura");
 const again=await fetch(base+"/good/processing/export",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({revision:result.revision})});assert.equal((await again.json()).id,output.id);
 await sql.run("UPDATE glpi_tickets SET hash='alterado' WHERE external_id='good'");
 assert.equal((await fetch(`http://127.0.0.1:${(server.address() as any).port}`+output.url)).status,409);
});
test("Divergência bloqueia download, correção explícita gera nova análise e preserva o documento original",async()=>{
 await fixture("wrong");await processContract("wrong","u",mock({...data,remuneracao:"11,00%"}) as any);
 const before=await completed("wrong");assert.equal(before.status,"Aguardando correção");assert.ok(before.issues.some((i:any)=>i.field==="remuneracao"));
 const denied=await fetch(base+"/wrong/processing/export",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({revision:before.revision})});assert.equal(denied.status,409);
 const source=await fileBytes(await sql.one("SELECT * FROM processing_files WHERE demand_id='wrong'"));
 const form=new FormData();form.set("revision",String(before.revision));form.set("values",JSON.stringify({remuneracao:"11,84%"}));
 const response=await fetch(base+"/wrong/processing/correct",{method:"POST",body:form});assert.equal(response.status,200);const corrected=await response.json();assert.equal(corrected.status,"Sem erros",JSON.stringify(corrected.issues));
 assert.deepEqual(await fileBytes(await sql.one("SELECT * FROM processing_files WHERE demand_id='wrong'")),source);
 const stale=new FormData();stale.set("revision",String(before.revision));stale.set("values","{}");assert.equal((await fetch(base+"/wrong/processing/correct",{method:"POST",body:stale})).status,409);
});
test("Confronta valor, remuneração e parcelas do pedido com o documento e não aceita correção divergente",async()=>{
 const raw=await fixture('request-parcelamento');raw.content='<p>RAZÃO SOCIAL: Escola teste</p><p>CNPJ: 11.444.777/0001-61</p><p>MOTIVO DO ADITIVO: PARCELAMENTO DE DÉBITOS</p><p>OBSERVAÇÕES OU CONSIDERAÇÕES ADICIONAIS: Valor parcelado: R$ 1.507,90</p><p>Remuneração Kedu: 4,58%</p><p>QTD parcelas: 3</p>';
 await sql.run('UPDATE glpi_tickets SET payload=? WHERE external_id=?', JSON.stringify(raw), raw.externalId);
 await processContract(raw.externalId,'u',mock({...data,valor:'1800,00',remuneracao:'5,00%',parcelas:'6'}) as any);
 const before=await completed(raw.externalId);assert.equal(before.type,'Parcelamento');
 for(const [key,expected,found] of [['valor','1507,90','1800,00'],['remuneracao','4,58%','5,00%'],['parcelas','3','6']]){
  assert.ok(before.issues.some((i:any)=>i.field===key&&i.expected===expected&&i.found===found));
  assert.ok(before.comparisons.some((i:any)=>i.field===key&&i.status==='different'));
 }
 const original=await fileBytes(await sql.one('SELECT * FROM processing_files WHERE demand_id=?', raw.externalId));
 await sql.run('UPDATE contract_processing SET overrides=? WHERE demand_id=?', JSON.stringify({valor:'1700,00'}), raw.externalId);
 assert.ok((await buildProcessingPlan(raw.externalId))!.issues.some(i=>i.field==='valor'&&i.expected==='1507,90'));
 await sql.run('UPDATE contract_processing SET overrides=? WHERE demand_id=?', JSON.stringify({valor:'1507,90',remuneracao:'4,58%',parcelas:'3'}), raw.externalId);
 assert.equal((await buildProcessingPlan(raw.externalId))!.comparisons.find(i=>i.field==='valor')?.status,'corrected');
 assert.deepEqual(await fileBytes(await sql.one('SELECT * FROM processing_files WHERE demand_id=?', raw.externalId)),original);
});

test("Cada chamado usa sua própria referência e a mesma referência aparece na tela GLPI",async()=>{
 const a=await fixture('global-reference-a'),b=await fixture('global-reference-b');
 b.content=b.content.replace('11,84%','9,50%')+'<p>TITULAR DA CONTA: Titular solicitado</p>';
 await sql.run('UPDATE glpi_tickets SET payload=? WHERE external_id=?', JSON.stringify(b), b.externalId);
 await processContract(a.externalId,'u',mock(data) as any);
 await processContract(b.externalId,'u',mock(data) as any);
 const pa=(await buildProcessingPlan(a.externalId))!,pb=(await buildProcessingPlan(b.externalId))!;
 assert.equal(pa.comparisons.find(r=>r.field==='remuneracao')?.status,'matches');
 assert.equal(pb.comparisons.find(r=>r.field==='remuneracao')?.expected,'9,50%');
 assert.equal(pb.comparisons.find(r=>r.field==='remuneracao')?.status,'different');
 assert.equal(pb.comparisons.find(r=>r.field==='titularConta')?.status,'different');
 const {listTickets}=await import('../server/glpi-sync.js');
 const refs=(await listTickets()).find(t=>t.external_id===b.externalId)!;
 assert.deepEqual(refs.reference.remuneracao,['9,50%']);assert.match(refs.requestText,/9,50%/);
});

test("Imagem e modelo sem homologação não são liberados como corretos",async()=>{
 await fixture("image","png");await processContract("image","u",(async()=>({bytes:readingImage(true).toBuffer('image/png'),name:'Contrato.png',mime:'image/png'})) as any);assert.equal((await completed("image")).status,"Aguardando análise");
 assert.ok((await completed("image")).issues.some((i:any)=>i.field.startsWith("file:")));
 await fixture("draft");await processContract("draft","u",mock({...data,modalidade:"Garantia Conjunta"}) as any);
 const draft=await completed("draft");assert.equal(draft.status,"Sem erros");assert.ok(draft.issues.some((i:any)=>i.field==="templateApproval"));
});

test("Visualização do original com pendências preserva bytes e exige permissão",async()=>{
 await fixture("view","png");
 const bytes=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
 await processContract("view","u",(async()=>({bytes,name:"anexo.png",mime:"image/png"})) as any);
 const result=await completed("view");assert.equal(result.status,"Aguardando análise");
 const url=base+"/view/processing/files/"+result.files[0].id+"/view";
 const response=await fetch(url);assert.equal(response.status,200);
 assert.equal(response.headers.get("content-disposition"),"inline");
 assert.equal(response.headers.get("content-type"),"image/png");
 assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
 assert.equal((await fetch(url,{headers:{"x-role":"Consulta"}})).status,403);
 assert.equal((await fetch(base+"/wrong/processing/files/"+result.files[0].id+"/view")).status,404);
 const docx=await sql.one("SELECT id FROM processing_files WHERE demand_id='wrong'");
 assert.equal((await fetch(base+"/wrong/processing/files/"+docx.id+"/view")).status,415);
});

test("OCR permanece bloqueado até conferência humana; confirmação respeita revisão e acesso",async()=>{
 await fixture("ocr","png");const bytes=readingImage().toBuffer("image/png");
 await processContract("ocr","u",(async()=>({bytes,name:"contrato.png",mime:"image/png"})) as any);
 // A legacy single-pass reading still requires explicit confirmation.
 await sql.run("UPDATE processing_files SET extracted=json_remove(extracted,'$.verifiedFields') WHERE demand_id='ocr'");
 const result=await completed("ocr");assert.equal(result.status,"Conferência parcial");assert.equal(result.values.remuneracao,"11,84%");assert.equal(result.files[0].needsReview,true);
 const url=base+"/ocr/processing/files/"+result.files[0].id+"/confirm";
 const post=(revision:number,role="Administrador")=>fetch(url,{method:"POST",headers:{"Content-Type":"application/json","x-role":role},body:JSON.stringify({revision,confirmed:true})});
 assert.equal((await post(result.revision,"Consulta")).status,403);
 assert.equal((await post(result.revision-1)).status,409);
 const response=await post(result.revision);assert.equal(response.status,200);const confirmed=await response.json();assert.equal(confirmed.files[0].needsReview,false);assert.equal(confirmed.status,"Conferência parcial","campos ainda não lidos continuam pendentes");
 assert.equal((await post(result.revision)).status,409);
 assert.deepEqual(await fileBytes(await sql.one("SELECT * FROM processing_files WHERE demand_id='ocr'")),bytes);
});
test('leitura parcial preservada não pode ser confirmada como documento completo',async()=>{
 await fixture('partial');await processContract('partial','u',mock());
 const file=await sql.one('SELECT * FROM processing_files WHERE demand_id=?', 'partial');
 const extracted={...JSON.parse(file.extracted),incomplete:true,needsReview:true,warnings:['Página restante não lida.']};
 await sql.run('UPDATE processing_files SET extracted=? WHERE id=?', JSON.stringify(extracted), file.id);
 const plan=(await saveProcessingResult('partial'))!;assert.ok(plan.issues.some(i=>i.field==='review:partial:'+file.id));
 const response=await fetch(base+'/partial/processing/files/'+file.id+'/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:plan.revision,confirmed:true})});
 assert.equal(response.status,400);assert.match((await response.json()).error,/incompleta/);
 assert.equal((await fetch(base+'/partial/processing/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:plan.revision})})).status,409);
 assert.equal(await sql.one('SELECT file_id FROM processing_file_reviews WHERE file_id=?', file.id),undefined);
});
test('conferência por campo é vinculada à extração e não dispensa outros campos',async()=>{
 await fixture('field-review');await processContract('field-review','u',mock());
 const file=await sql.one('SELECT * FROM processing_files WHERE demand_id=?', 'field-review');
 const extracted={...JSON.parse(file.extracted),needsReview:true,method:'OCR',verifiedFields:[],digitalFields:{}};
 await sql.run('UPDATE processing_files SET extracted=? WHERE id=?', JSON.stringify(extracted), file.id);
 let result=(await saveProcessingResult('field-review'))!;
 const post=(field:string,value:string,revision:number,role='Administrador')=>fetch(base+'/field-review/processing/files/'+file.id+'/fields/'+field+'/confirm',{method:'POST',headers:{'Content-Type':'application/json','x-role':role},body:JSON.stringify({revision,value,confirmed:true})});
 assert.equal((await post('cnpj',data.cnpj,result.revision,'Consulta')).status,403);
 assert.equal((await post('cnpj',data.cnpj,result.revision-1)).status,409);
 assert.equal((await post('cnpj','valor inventado',result.revision)).status,409);
 const response=await post('cnpj',result.files[0].fieldReviews.find(f=>f.key==='cnpj')!.values[0],result.revision);
 assert.equal(response.status,200);result=await response.json();
 assert.equal(result.files[0].fieldReviews.find(f=>f.key==='cnpj')!.confirmed,true);
 assert.equal(result.files[0].needsReview,true,'outros campos continuam pendentes');
 await sql.run('UPDATE processing_files SET extracted=? WHERE id=?', JSON.stringify({...extracted,text:extracted.text+'\nNova versão'}), file.id);
 assert.equal((await saveProcessingResult('field-review'))!.files[0].fieldReviews.find(f=>f.key==='cnpj')!.confirmed,false);
});
test('um campo OCR verificado confere mesmo quando outro campo do arquivo exige revisão',async()=>{
 await fixture('selective-reading');await processContract('selective-reading','u',mock());
 const file=await sql.one('SELECT * FROM processing_files WHERE demand_id=?', 'selective-reading');
 const extracted={...JSON.parse(file.extracted),method:'OCR de imagem',pages:1,needsReview:true,verifiedFields:['cnpj'],digitalFields:{}};
 await sql.run('UPDATE processing_files SET extracted=? WHERE id=?', JSON.stringify(extracted), file.id);
 let result=(await saveProcessingResult('selective-reading'))!;
 assert.equal(result.comparisons.find(c=>c.field==='cnpj')?.status,'matches');
 assert.equal(result.comparisons.find(c=>c.field==='remuneracao')?.status,'review');
 assert.equal(result.files[0].needsReview,true);
 extracted.incomplete=true;await sql.run('UPDATE processing_files SET extracted=? WHERE id=?', JSON.stringify(extracted), file.id);
 result=(await saveProcessingResult('selective-reading'))!;assert.equal(result.comparisons.find(c=>c.field==='cnpj')?.status,'review');
});
test('campo digital confere individualmente, mas o PDF parcial mantém a demanda em análise',async()=>{
 const raw=await fixture('digital-partial');raw.content+='<p>ENDEREÇO: Rua Teste, 10</p>';
 await sql.run('UPDATE glpi_tickets SET payload=? WHERE external_id=?', JSON.stringify(raw), 'digital-partial');
 await processContract('digital-partial','u',mock());
 const file=await sql.one('SELECT * FROM processing_files WHERE demand_id=?', 'digital-partial');
 const e=JSON.parse(file.extracted);
 e.method='PDF com OCR';e.needsReview=true;e.incomplete=true;e.pages=16;
 e.digitalFields={razaoSocial:[data.razaoSocial],cnpj:[data.cnpj],rua:[data.rua],numero:[data.numero]};
 await sql.run('UPDATE processing_files SET extracted=? WHERE id=?', JSON.stringify(e), file.id);
 const result=(await saveProcessingResult('digital-partial'))!;
 for(const key of ['cnpj','razaoSocial','endereco'])assert.equal(result.comparisons.find(c=>c.field===key)?.status,'matches',key);
 assert.equal(result.status,'Conferência parcial');
 assert.ok(result.issues.some(i=>i.field==='review:partial:'+file.id));
 assert.equal(result.comparisons.find(c=>c.field==='remuneracao')?.status,'review');
});

test('campos solicitados comprovados não herdam revisão de campos OCR não usados; arquivo parcial ainda bloqueia',async()=>{
 await fixture('field-certainty');await processContract('field-certainty','u',mock());
 const f=await sql.one('SELECT * FROM processing_files WHERE demand_id=?', 'field-certainty'),e=JSON.parse(f.extracted);
 e.method='PDF com OCR';e.pages=1;e.needsReview=true;e.confidence=50;e.digitalFields={cnpj:e.fields.cnpj,razaoSocial:e.fields.razaoSocial,remuneracao:e.fields.remuneracao};
 await sql.run('UPDATE processing_files SET extracted=? WHERE id=?', JSON.stringify(e), f.id);
 let r=(await saveProcessingResult('field-certainty'))!;assert.equal(r.status,'Sem erros');assert.ok(!r.issues.some(i=>i.field==='review:'+f.id));
 e.incomplete=true;await sql.run('UPDATE processing_files SET extracted=? WHERE id=?', JSON.stringify(e), f.id);
 r=(await saveProcessingResult('field-certainty'))!;assert.equal(r.status,'Conferência parcial');assert.ok(r.issues.some(i=>i.field==='review:partial:'+f.id));
});

test('frase capturada como taxa não vira percentual inválido, mas taxa numérica fora da faixa é sinalizada',async()=>{
 await fixture('percent-artifact');await processContract('percent-artifact','u',mock());
 const file=await sql.one('SELECT * FROM processing_files WHERE demand_id=?', 'percent-artifact');const e=JSON.parse(file.extracted);
 e.fields.remuneracao=['Montante integral dos créditos anuais'];await sql.run('UPDATE processing_files SET extracted=? WHERE id=?', JSON.stringify(e), file.id);
 assert.ok(!(await saveProcessingResult('percent-artifact'))!.issues.some(i=>i.field==='review:validation:remuneracao'));
 e.fields.remuneracao=['110,00%'];await sql.run('UPDATE processing_files SET extracted=? WHERE id=?', JSON.stringify(e), file.id);
 assert.ok((await saveProcessingResult('percent-artifact'))!.issues.some(i=>i.field==='review:validation:remuneracao'));
});

test('CNPJ inválido no GLPI pede confirmação da referência, não correção do documento',async()=>{
 const raw=await fixture('invalid-reference');raw.content=raw.content.replace('11.444.777/0001-61','1.444.777/0001-61');
 await sql.run('UPDATE glpi_tickets SET payload=? WHERE external_id=?', JSON.stringify(raw), 'invalid-reference');
 await processContract('invalid-reference','u',mock());const result=(await saveProcessingResult('invalid-reference'))!;
 assert.equal(result.comparisons.find(c=>c.field==='cnpj')?.status,'ambiguous');
 assert.equal(result.status,'Conferência parcial');
});

test('nova versão sem anexo atual informa atualização pendente, sem reutilizar leitura antiga',async()=>{
 await fixture('new-version');await processContract('new-version','u',mock());
 await sql.run('UPDATE glpi_tickets SET hash=? WHERE external_id=?', 'new-hash', 'new-version');await ensureProcessing('new-version');
 const result=(await saveProcessingResult('new-version'))!;
 assert.equal(result.comparisons.find(c=>c.field==='cnpj')?.missingReason,'awaiting_version');
 assert.equal(result.comparisons.find(c=>c.field==='cnpj')?.found,'');
});

test('resumos respeitam etapa, seleção e permissões de acesso aos documentos',async()=>{
 const stage=(await completed('field-review')).status;
 const url=base.replace('/demands','')+'/processing/summary?'+new URLSearchParams({stage,ids:'field-review'});
 const response=await fetch(url,{headers:{connection:'close'}});assert.equal(response.status,200,await response.clone().text());
 const summary=await response.json();assert.equal(summary.count,1);assert.match(summary.markdown,/GLPI #field-review/);
 assert.equal((await fetch(url,{headers:{'x-role':'Consulta',connection:'close'}})).status,403);
 const empty=await fetch(base.replace('/demands','')+'/processing/summary?'+new URLSearchParams({stage,ids:'inexistente'}),{headers:{connection:'close'}});
 assert.equal((await empty.json()).count,0);
});
test("Substituição manual de imagem por DOCX legível preenche os dados e libera a validação",async()=>{
 const before=await completed("image"),original=await sql.one("SELECT * FROM processing_files WHERE demand_id='image' ORDER BY rowid LIMIT 1");
 const f=new FormData();f.set("revision",String(before.revision));f.set("values","{}");f.set("document_id","7");f.set("file",new Blob([new Uint8Array(doc(data))]),"Contrato-corrigido.docx");
 const response=await fetch(base+"/image/processing/correct",{method:"POST",body:f});assert.equal(response.status,200);const result=await response.json();assert.equal(result.status,"Sem erros",JSON.stringify(result.issues));
 assert.equal((await sql.one("SELECT COUNT(*) n FROM processing_files WHERE demand_id='image'")).n,2);
 assert.deepEqual(await fileBytes(await sql.one("SELECT * FROM processing_files WHERE id=?", original.id)),await fileBytes(original));
});
test("Prévia permite homologar o modelo sem liberar contrato pendente",async()=>{
 const response=await fetch(base+"/draft/processing/preview",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});assert.equal(response.status,200);const result=await response.json();
 const preview=await sql.one("SELECT * FROM template_previews WHERE id=?", result.id);
 assert.match(paragraphs(Buffer.from(preview.bytes)).join(" "),/NÃO UTILIZAR PARA ASSINATURA/);
 assert.equal((await completed("draft")).status,"Sem erros");
 assert.equal((await sql.one("SELECT COUNT(*) n FROM processing_exports WHERE demand_id='draft'")).n,0);
});
test("Aditivo só reserva o próximo número ao baixar; repetição usa o mesmo contrato e arquivo",async()=>{
 const raw=await fixture("addendum");raw.title="Solicitação de aditivo";raw.content+="<p>MOTIVO DO ADITIVO: Alteração de taxa</p>";
 await sql.run("UPDATE glpi_tickets SET payload=?,title=? WHERE external_id='addendum'", JSON.stringify(raw), raw.title);
 await sql.run("INSERT INTO contracts(id,school_id,status) VALUES('matrix','s','Assinado')");
 await sql.run("INSERT INTO signed_history VALUES('history','matrix',0,'Clicksign','Referência de teste','2020-01-01','u',?)", now());
 const t=await sql.one("SELECT v.* FROM template_versions v JOIN template_catalog c ON c.version_id=v.id WHERE c.subtype='Taxa de remuneração' LIMIT 1");
 await sql.run("INSERT INTO template_homologations VALUES(?,?,?,?,?)", t.id, "u", "Homologação de teste do aditivo", now(), sha256(Buffer.from(t.bytes)));await sql.run("UPDATE template_versions SET status='aprovado',approved_by='u' WHERE id=?", t.id);
 await processContract("addendum","u",mock({...data,dataAssinaturaMatriz:"2020-01-01"}) as any);
 const result=await completed("addendum");assert.equal(result.status,"Sem erros",JSON.stringify(result.issues));
 assert.equal((await sql.one("SELECT COUNT(*) n FROM contracts WHERE parent_id='matrix'")).n,0);
 const post=()=>fetch(base+"/addendum/processing/export",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({revision:result.revision})});
 const first=await post();assert.equal(first.status,200,await first.clone().text());const output=await first.json();
 assert.equal((await sql.one("SELECT COUNT(*) n FROM contracts WHERE parent_id='matrix' AND sequence=1")).n,1);
 const second=await post();assert.equal(second.status,200,await second.clone().text());assert.equal((await second.json()).id,output.id);
 assert.equal((await sql.one("SELECT COUNT(*) n FROM contracts WHERE parent_id='matrix'")).n,1);
});
test("Perfil sem permissão não lê dados extraídos nem libera contrato",async()=>{
 assert.equal((await fetch(base+"/wrong/processing",{headers:{"x-role":"Consulta"}})).status,403);
 assert.equal((await fetch(base+"/wrong/processing/export",{method:"POST",headers:{"Content-Type":"application/json","x-role":"Consulta"},body:JSON.stringify({revision:1})})).status,403);
});
test("Modelo de garantia não é usado para contrato educacional, mesmo quando enviado diretamente à API",async()=>{
 const raw=await fixture("education");raw.title="Solicitação de contratos diversos";raw.content+="<p>ESPECIFIQUE O CONTRATO: Contrato educacional Kedu Matrículas</p>";
 await sql.run("UPDATE glpi_tickets SET payload=?,title=? WHERE external_id='education'", JSON.stringify(raw), raw.title);
 await processContract("education","u",mock() as any);
 const result=await completed("education");assert.equal(result.status,"Sem erros");assert.equal(result.templates.length,0);
 const f=new FormData();f.set("revision",String(result.revision));f.set("values","{}");f.set("template_id",template.id);
 const response=await fetch(base+"/education/processing/correct",{method:"POST",body:f});assert.equal(response.status,200);assert.equal((await response.json()).status,"Sem erros");
});

test('duplicata OCR incerta não rebaixa divergência comprovada por campo digital',async()=>{
 const raw=await fixture('proven-mismatch-duplicate');raw.content+='<p>CIDADE: Fortaleza</p>';
 await sql.run('UPDATE glpi_tickets SET payload=? WHERE external_id=?', JSON.stringify(raw), 'proven-mismatch-duplicate');
 await processContract('proven-mismatch-duplicate','u',mock({...data,cidade:'Recife'}));
 await sql.run('INSERT INTO processing_files VALUES(?,?,?,?,?,?,?,?,?,?)', 'uncertain-city-copy', 'proven-mismatch-duplicate', '8', 'hash-proven-mismatch-duplicate', 'copia.png', 'image/png', Buffer.from('original'), JSON.stringify({version:4,text:'Cidade: Recife',fields:{cidade:['Recife']},needsReview:true,method:'OCR de imagem',pages:1,confidence:40}), '', now());
 const result=(await saveProcessingResult('proven-mismatch-duplicate'))!;
 const city=result.comparisons.find(c=>c.field==='cidade')!;
 assert.equal(city.status,'different');assert.equal(city.readingPending,false);
 assert.equal(result.status,'Aguardando correção');
});

test('ocorrência do valor do GLPI sem associação a campo não gera confirmação automática',async ()=>{
 await fixture('guided-without-field');await ensureProcessing('guided-without-field');
 await sql.run('INSERT INTO processing_files VALUES(?,?,?,?,?,?,?,?,?,?)', 'guided-without-field-file', 'guided-without-field', '7', 'hash-guided-without-field', 'Contrato.pdf', 'application/pdf', Buffer.from('original'), JSON.stringify({version:4,text:'Comentário: Escola teste',fields:{},needsReview:false,method:'Texto do PDF',pages:1,digitalFields:{}}), '', now());
 const result=(await saveProcessingResult('guided-without-field'))!;
 const name=result.comparisons.find(c=>c.field==='razaoSocial')!;
 assert.equal(name.status,'review');assert.equal(name.readingPending,true);
 assert.equal(name.reviewReason?.code,'value_unassociated');
});

test('fórmulas não solicitadas não bloqueiam CNPJ comprovado em célula literal',async ()=>{
 const raw=await fixture('literal-sheet-identity');raw.content='<p>CNPJ: 11.444.777/0001-61</p>';
 await sql.run('UPDATE glpi_tickets SET payload=? WHERE external_id=?', JSON.stringify(raw), 'literal-sheet-identity');await ensureProcessing('literal-sheet-identity');
 await sql.run('INSERT INTO processing_files VALUES(?,?,?,?,?,?,?,?,?,?)', 'literal-sheet-file', 'literal-sheet-identity', '7', 'hash-literal-sheet-identity', 'Dados.xlsx', 'application/octet-stream', Buffer.from('original'), JSON.stringify({version:4,text:'CNPJ: 11.444.777/0001-61',fields:{cnpj:['11.444.777/0001-61']},digitalFields:{cnpj:['11.444.777/0001-61']},literalIdentityFields:{cnpj:['11.444.777/0001-61']},formulaCount:500,needsReview:true,method:'XLSX',pages:1}), '', now());
 const result=(await saveProcessingResult('literal-sheet-identity'))!;
 assert.equal(result.comparisons.find(c=>c.field==='cnpj')!.status,'matches');
 assert.equal(result.issues.some(i=>i.field==='review:literal-sheet-file'),false);
 assert.equal(result.status,'Sem erros');
});

test('tarefa de leitura registra o motivo da recuperação pendente',async()=>{
 await fixture('reason-denied');
 await processContract('reason-denied','u',async()=>{throw Object.assign(Error('O GLPI não disponibilizou o arquivo para download (HTTP 403).'),{status:403});});
 const reason=await recoveryReason('reason-denied','hash-reason-denied',true);
 assert.match(reason,/Contrato\.docx: download falhou — O GLPI não disponibilizou o arquivo.*\(HTTP 403\)/);
 await fixture('reason-empty');await ensureProcessing('reason-empty');
 await sql.run('INSERT INTO processing_files VALUES(?,?,?,?,?,?,?,?,?,?)', 'reason-empty-file', 'reason-empty', '7', 'hash-reason-empty', 'Contrato.docx', 'application/octet-stream', Buffer.from('original'), JSON.stringify({version:4,text:'',fields:{},method:'DOCX',pages:1}), '', now());
 assert.equal(await recoveryReason('reason-empty','hash-reason-empty',true),'Contrato.docx: lido sem texto nem campos reconhecidos');
 await fixture('reason-missing');
 assert.equal(await recoveryReason('reason-missing','hash-reason-missing',true),'Contrato.docx: anexo ainda não baixado');
});

test('checksum importado do documento reutiliza bytes locais idênticos sem novo download',async()=>{
 const raw=await fixture('checksum-reuse');await processContract('checksum-reuse','u',mock());
 const f=await sql.one('SELECT * FROM processing_files WHERE demand_id=?', 'checksum-reuse');
 const {createHash}=await import('node:crypto');(raw.documents[0] as any).sha1=createHash('sha1').update(await fileBytes(f)).digest('hex');
 await sql.run('UPDATE glpi_tickets SET hash=?,payload=? WHERE external_id=?', 'hash-checksum-current', JSON.stringify(raw), 'checksum-reuse');
 let downloads=0;await processContract('checksum-reuse','u',async()=>{downloads++;throw Error('Não deveria baixar bytes iguais');});
 assert.equal(downloads,0);
 assert.ok(await sql.one('SELECT id FROM processing_files WHERE demand_id=? AND ticket_hash=?', 'checksum-reuse', 'hash-checksum-current'));
});
