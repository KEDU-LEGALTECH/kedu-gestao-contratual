import PizZip from 'pizzip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { officialSlotKeys } from '../shared/official-fields.js';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const metadata='customXml/kedu-template.json';
export function structuredProfile(bytes: Buffer) {
  const raw=new PizZip(bytes).file(metadata)?.asText();
  if (!raw) return null;
  const value=JSON.parse(raw);
  if(typeof value.profile !== 'string' || !/^(?:kedu-vigencia-v1|canva-(?:aditivo|contrato)_[a-z_]+)$/.test(value.profile)) throw Error('Perfil de modelo não suportado.');
  return value.profile as string;
}
const norm=(text:string)=>text.normalize('NFC').replace(/\s+/g,' ').trim();
function read(bytes:Buffer) {
  const zip=new PizZip(bytes), xml=zip.file('word/document.xml')?.asText();
  if(!xml || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw Error('XML inválido.');
  const document=new DOMParser({onError:()=>{throw Error('XML não pode ser interpretado com segurança.');}}).parseFromString(xml,'application/xml');
  if(!document.documentElement || document.documentElement.namespaceURI!==W || document.documentElement.localName!=='document') throw Error('Documento Word inválido.');
  const elements=Array.from(document.getElementsByTagName('*'));
  const forbidden=['drawing','pict','object','altChunk','instrText','del','ins','vanish','webHidden','fldChar','subDoc','txbxContent'];
  for(const element of elements) if(element.namespaceURI!==W || forbidden.includes(element.localName || '')) throw Error('Estrutura não suportada para conferência.');
  const controls=Array.from(document.getElementsByTagNameNS(W,'sdt')).map(control=>{
    const tags=Array.from(control.getElementsByTagNameNS(W,'tag'));
    const contents=Array.from(control.getElementsByTagNameNS(W,'sdtContent'));
    if(tags.length!==1 || contents.length!==1 || control.getElementsByTagNameNS(W,'sdt').length) throw Error('Controle de campo ambíguo.');
    const key=tags[0].getAttributeNS(W,'val')?.replace(/^kedu:/,'') || '';
    if(!officialSlotKeys.includes(key) || tags[0].getAttributeNS(W,'val')!=='kedu:'+key) throw Error('Campo não autorizado.');
    const content=contents[0];
    if(content.getElementsByTagNameNS(W,'p').length || content.getElementsByTagNameNS(W,'tbl').length) throw Error('Campo deve ser texto simples em linha.');
    const texts=Array.from(content.getElementsByTagNameNS(W,'t'));
    if(!texts.length) throw Error('Campo sem texto identificável.');
    const value=texts.map(t=>t.textContent || '').join('');
    const position=Array.from(document.getElementsByTagNameNS(W,'p')).findIndex(p=>p===control.parentNode || Array.from(p.getElementsByTagNameNS(W,'sdt')).includes(control));
    return {key,control,content,texts,value,location:'Parágrafo '+(position+1)};
  });
  // Comparing the paragraph skeleton also detects moved/removed controls and added clauses.
  const skeleton=Array.from(document.getElementsByTagNameNS(W,'p')).map(p=>{
    function walk(node:any):string {
      if(node.nodeType!==1) return '';
      if(node.namespaceURI===W && node.localName==='sdt') {
        const c=controls.find(c=>c.control===node); if(!c) throw Error('Campo ambíguo.');return ' ⟦'+c.key+'⟧ ';
      }
      if(node.namespaceURI===W && node.localName==='t') return node.textContent || '';
      if(node.namespaceURI===W && ['br','tab'].includes(node.localName)) return ' ';
      return Array.from(node.childNodes).map(walk).join('');
    }
    return norm(walk(p));
  }).filter(Boolean);
  return {zip,document,controls,skeleton};
}
export function generateStructured(bytes:Buffer,data:Record<string,string>) {
  const parsed=read(bytes);
  const actual=parsed.controls.map(c=>c.key);
  const manifest=JSON.parse(parsed.zip.file(metadata)!.asText());
  if(JSON.stringify(actual)!==JSON.stringify(manifest.slots) || !actual.includes('avisoHomologacao')) throw Error('O modelo não contém todos os campos previstos.');
  for(const field of parsed.controls) {
    if(data[field.key]===undefined || (!['avisoHomologacao','pix'].includes(field.key) && !String(data[field.key]).trim())) throw Error('Dado obrigatório do modelo: '+field.key);
    field.texts[0].textContent=String(data[field.key]);
    for(const text of field.texts.slice(1)) text.textContent='';
  }
  parsed.zip.file('word/document.xml',new XMLSerializer().serializeToString(parsed.document));
  return parsed.zip.generate({type:'nodebuffer'});
}
export function reviewStructured(bytes:Buffer,expected:Record<string,string>,template:Buffer) {
  const reference=read(generateStructured(template,expected)),candidate=read(bytes),results:any[]=[];
  for(const field of reference.controls.filter((c,i,a)=>a.findIndex(x=>x.key===c.key)===i)) {
    const found=candidate.controls.filter(c=>c.key===field.key);
    const count=reference.controls.filter(c=>c.key===field.key).length;
    if(found.length!==count || found.some(c=>norm(c.value)!==norm(expected[field.key] || ''))) results.push({field:field.key,expected:expected[field.key] || '',found:found.length?found.map(c=>c.value).join(' | '):'Ausente',location:found[0]?.location || field.location,severity:'crítica',guidance:found.length!==count?'Corrija os campos ausentes ou duplicados e confira novamente.':'Corrija o campo conforme os dados confirmados e envie nova versão.'});
  }
  if(JSON.stringify(reference.skeleton)!==JSON.stringify(candidate.skeleton)) results.push({field:'Corpo fixo',expected:reference.skeleton.join('\n'),found:candidate.skeleton.join('\n'),location:'Corpo do documento',severity:'crítica',guidance:'Revisão jurídica obrigatória. Restaure o modelo aprovado e a posição dos campos.'});
  const text=candidate.controls.map(c=>c.value).join('\n');
  if(/\{[^}]+\}|\[(?:DADO|PREENCHER|NOME|CNPJ|VALOR|DATA)[^\]]*\]/i.test(text)) results.push({field:'Placeholder',expected:'Preenchido',found:'Variável não preenchida',location:'Campos variáveis',severity:'crítica',guidance:'Preencha todas as variáveis antes de prosseguir.'});
  return {status:results.length?'divergente':'conforme',results};
}
/** Validates a structured template without filling it: safe structure and manifest/slot agreement. */
export function inspectStructured(bytes:Buffer) {
  const parsed=read(bytes);
  const manifest=JSON.parse(parsed.zip.file(metadata)!.asText());
  const actual=parsed.controls.map(c=>c.key);
  if(JSON.stringify(actual)!==JSON.stringify(manifest.slots) || !actual.includes('avisoHomologacao')) throw Error('O modelo não contém todos os campos previstos.');
  return {profile:manifest.profile as string,slots:actual};
}
