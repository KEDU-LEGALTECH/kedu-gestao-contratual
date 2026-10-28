type Fields=Record<string,string[]>;
/** Only explicit representative/administrator/proxy clauses; a list of partners is not authority. */
export function structuredIdentityFields(text:string):Fields {
 const result:Fields={};
 const add=(key:string,value:string)=>{if(!(result[key]||=[]).includes(value))result[key].push(value);};
 const pattern=/(?:representad[ao](?:\s+neste ato)?\s+(?:por|pel[oa])(?:\s+(?:seu|sua))?(?:\s+(?:s[óo]ci[oa](?:\s+administrador[ao])?|administrador[ao]|procurador[ao]?|representante legal))?|representante legal\s*[:\-]|procurador(?:a)?\s*[:\-]|outorgad[oa](?:\s*\(a\))?\s*[:\-]|administra[çc][ãa]o[^.\n]{0,60}?caber[áa]\s+(?:a[oà]?\s+)?(?:s[óo]ci[oa]\s+)?)\s*([\p{L}][\p{L} .'’\-]{4,120}?)(?=\s*[,;\n])/giu;
 for(const match of text.matchAll(pattern)){
  const name=match[1].trim();if(name.split(/\s+/).length<2)continue;
  const tail=text.slice(match.index!+match[0].length,match.index!+match[0].length+350);
  // Do not cross into a second person's qualification or a different role.
  const scope=tail.split(/\n\s*(?:OUTORGANTE|OUTORGAD[OA]|S[ÓO]CI[OA]|REPRESENTANTE|CONTRATANTE|CONTRATAD[OA])\b/i)[0];
  const cpfs=[...scope.matchAll(/\bCPF\s*(?:\/MF\s*)?(?:sob\s+(?:o\s+)?)?(?:n[.º°o]*\s*)?[:\s]*([\d.\-]{11,14})(?!\d)/gi)].map(m=>m[1].replace(/\D/g,''));
  if(cpfs.length!==1||cpfs[0].length!==11)continue;
  add('representanteNome',name);const cpf=cpfs[0];
  add('representanteCpf',`${cpf.slice(0,3)}.${cpf.slice(3,6)}.${cpf.slice(6,9)}-${cpf.slice(9)}`);
 }
 return result;
}
