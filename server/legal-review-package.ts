import "dotenv/config";
import {mkdir,writeFile} from "node:fs/promises";
import {resolve,join} from "node:path";
import PizZip from "pizzip";
import { one, db, sql } from "./db.js";
import {listOfficial,officialValues,sha256} from "./official-templates.js";
import {generate} from "./documents.js";
const folder=resolve("entregas/revisao-juridica-"+new Date().toISOString().replace(/[:.]/g,"-"));
await mkdir(folder,{recursive:true});const zip=new PizZip(),manifest:any[]=[];
for(const [i,item] of (await listOfficial()).filter(t=>!t.inactive).entries()) {
 const version=await sql.one("SELECT * FROM template_versions WHERE id=?", item.version_id),bytes=Buffer.from(version.bytes);
 if(sha256(bytes)!==item.template_hash)throw Error("Modelo mudou: gere o pacote novamente após conferir a versão.");
 const preview=await officialValues({contract_id:null,type:item.document_type},{},version,"preview");
 const rendered=generate(bytes,preview.values),base=String(i+1).padStart(2,"0")+"-"+item.profile.replace(/[^a-zA-Z0-9_-]/g,"_")+"-v"+item.version;
 zip.file(base+"-modelo-editavel.docx",bytes);zip.file(base+"-previa-NAO-ASSINAR.docx",rendered);
 manifest.push({name:item.name,versionId:item.version_id,version:item.version,type:item.document_type,subtype:item.subtype,modality:item.modality,source:item.source_url,templateSha256:item.template_hash,previewSha256:sha256(rendered),homologated:!!item.homologated_at,gaps:preview.gaps});
}
const checklist="# Conferência dos modelos de contrato\n\nEste pacote não aprova modelos nem autoriza assinatura. As prévias exibem campos PENDENTES e aviso de não utilização para assinatura; não contêm dados de demandas reais.\n\nPara cada modelo:\n\n- Comparar cláusulas, ordem e redação com a fonte oficial no Canva.\n- Conferir cabeçalhos, tabelas, rodapés, assinaturas e impressão no Word e no Google Docs.\n- Conferir identificação das partes, condições, valores numéricos e por extenso, vigência e poderes de assinatura.\n- Anotar os ajustes e a referência do parecer, ata ou chamado.\n- Depois dos ajustes, gerar uma prévia vinculada a uma demanda no portal e conferir novamente.\n- Registrar a homologação no portal apenas pela pessoa responsável, para a versão e hash exatos. Estas prévias externas não registram homologação nem substituem o registro de prévia no portal.\n\nModelos ausentes e tipo da demanda devem ser definidos pelo responsável. Não adaptar um contrato de garantia para atender automaticamente contrato educacional, fornecedor ou marketing.\n";
zip.file("LEIA-ME.md",checklist);zip.file("manifesto.json",JSON.stringify(manifest,null,2));
const path=join(folder,"Modelos_para_conferencia_Juridico.zip");await writeFile(path,zip.generate({type:"nodebuffer"}));
await writeFile(join(folder,"LEIA-ME.md"),checklist);
console.log(JSON.stringify({path,models:manifest.length,homologationsRecorded:0}));db.close();
