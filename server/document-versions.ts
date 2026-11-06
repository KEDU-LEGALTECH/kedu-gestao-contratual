const revised=/\b(?:revisad[oa]s?|atualizad[oa]s?|ajustad[oa]s?|corrigid[oa]s?|final|versao\s*\d+|v\d+)\b/g;
const versionable=/\.(pdf|docx?|odt|xlsx|pptx)$/i;
const fold=(name:string)=>name.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[_\s]+/g,' ');
const stem=(name:string)=>fold(name).replace(versionable,'').replace(revised,' ').replace(/\(\d+\)/g,' ').replace(/[^a-z0-9]+/g,' ').trim();
/** Which documents a later attachment explicitly replaces. The link is clear only when the file has the
 * same name and extension and the later one declares itself revised. Everything else stays a human choice.
 * Copy suffixes such as "(1)" prove nothing: two photos with that suffix are different documents. */
export function supersededDocuments(documents:{id:string|number;name?:string}[]) {
 const links=new Map<string,string>();
 const docs=documents.filter(d=>versionable.test(d.name||'')).sort((a,b)=>Number(a.id)-Number(b.id));
 for(const older of docs){
  const key=stem(older.name!),extension=versionable.exec(older.name!)![1].toLowerCase();
  if(key.length<8)continue;
  const newer=docs.filter(d=>Number(d.id)>Number(older.id)&&stem(d.name!)===key&&versionable.exec(d.name!)![1].toLowerCase()===extension&&(fold(d.name!).match(revised)?.length||0)>(fold(older.name!).match(revised)?.length||0)).at(-1);
  if(newer)links.set(String(older.id),newer.name!);
 }
 return links;
}
