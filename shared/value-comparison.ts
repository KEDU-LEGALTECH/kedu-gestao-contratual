const states:Record<string,string>={ac:'acre',al:'alagoas',ap:'amapa',am:'amazonas',ba:'bahia',ce:'ceara',df:'distrito federal',es:'espirito santo',go:'goias',ma:'maranhao',mt:'mato grosso',ms:'mato grosso do sul',mg:'minas gerais',pa:'para',pb:'paraiba',pr:'parana',pe:'pernambuco',pi:'piaui',rj:'rio de janeiro',rn:'rio grande do norte',rs:'rio grande do sul',ro:'rondonia',rr:'roraima',sc:'santa catarina',sp:'sao paulo',se:'sergipe',to:'tocantins'};
// Bank names, brands and compensation codes that identify the same institution.
const banks:[RegExp,string][]=[[/\b(?:nu ?bank|nu pagamentos|0?260)\b/,'260'],[/\b(?:santander|0?033)\b/,'033'],[/\b(?:caixa(?: economica)?|cef|104)\b/,'104'],[/\b(?:banco do brasil|bb|001)\b|^brasil$/,'001'],[/\b(?:itau|341)\b/,'341'],[/\b(?:bradesco|237)\b/,'237'],[/\b(?:cora|403)\b/,'403'],[/\b(?:inter|0?77)\b/,'077'],[/\b(?:sicoob|756)\b/,'756'],[/\b(?:sicredi|748)\b/,'748'],[/\b(?:c6|336)\b/,'336'],[/\b(?:pagbank|pagseguro|290)\b/,'290'],[/\b(?:mercado pago|323)\b/,'323'],[/\b(?:btg|208)\b/,'208'],[/\b(?:safra|422)\b/,'422'],[/\b(?:banrisul|041)\b/,'041'],[/\b(?:banco do nordeste|bnb|004)\b/,'004'],[/\b(?:stone|197)\b/,'197'],[/\b(?:asaas|461)\b/,'461']];
export function canonicalFieldValue(key:string,value:string) {
 let v=value.normalize('NFKC').replace(/\p{Cf}/gu,'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/\s+/g,' ').trim();
 if(key==='banco'){const b=v.replace(/[.\-–—]/g,' ').replace(/\s+/g,' ');const known=banks.find(([pattern])=>pattern.test(b));if(known)return known[1];}
 if(['agencia','conta'].includes(key))return v.replace(/[.\s\-\u2010-\u2015]/g,'').replace(/[,:;]+$/,'').replace(key==='agencia'?/^0+(?=\d)/:/$^/,'');
 if(['cnpj','representanteCpf','documentoTitular','cep'].includes(key)&&/^[\d.\/\s\-]+[.,;]?$/.test(v))return v.replace(/\D/g,'');
 if(key==='estado'){v=v.replace(/^estado d[eo] |^estado da /,'');return states[v]||v;}
 if(['remuneracao','garantia','repasse','repasseSegundo','cashback'].includes(key)){
  const m=/^(\d{1,3})(?:[.,](\d{1,2}))?\s*%$/.exec(v);if(m)return `${Number(m[1])},${(m[2]||'').padEnd(2,'0')}%`;
 }
 if(['valor','valorTotal','valorParcela','cashbackValor'].includes(key)){
  const m=/^(?:r\$\s*)?(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})$/.exec(v);if(m)return `${Number(m[1].replaceAll('.',''))},${m[2]}`;
 }
 if(['inicio','fim','dataFormalizacao','dataAssinaturaMatriz'].includes(key)){const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);if(m)return `${m[3]}-${m[2]}-${m[1]}`;}
 // Legal-form suffixes, quotes and punctuation do not identify a different company.
 if(['razaoSocial','nomeFantasia','titularConta'].includes(key))v=v.replace(/,\s*nome fantasia\b.*$/,'').replace(/["'“”‘’„‟‚‛«»‹›`´]/g,'').replace(/[.,]/g,' ').replace(/\s+-\s+/g,' ').replace(/\s+/g,' ').trim().replace(/(?:\s+(?:ltda|ltd|me|epp|eireli|s\/?a))+\s*$/,'').trim();
 if(['endereco','rua'].includes(key))v=v.replace(/^av(?:enida)?\.?\s+/,'avenida ').replace(/^r(?:ua)?\.?\s+/,'rua ').replace(/\s+[\-\u2010-\u2015]\s+|[,]+/g,' ').replace(/\s+/g,' ').trim();
 return v;
}
// Street and number of a free-text address; neighbourhood, city and state vary between sources.
function addressParts(value:string) {
 const v=value.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/\b(?:num|numero)\.?\s*(?=\d)/g,'nº ').replace(/\s+/g,' ').trim();
 const m=/^((?:rua|r|avenida|av|travessa|tv|rodovia|estrada|alameda|al|praca|pc|quadra|largo)\.?\s+[^,:\-–—\d]+)(?:[,\s]*(?:-\s*)?(?:n[o°º]?\.?\s*)?(\d{1,6}[a-z]?|s\/?n)\b)?/.exec(v);
 if(!m)return null;
 const street=m[1].replace(/\s+bairro\b.*$/,'').replace(/[\s,]+(?:n[o°º]?\.?)?\s*$/,'').replace(/^(?:r|rua)\.?\s+/,'rua ').replace(/^(?:av|avenida)\.?\s+/,'avenida ').replace(/^(?:tv|travessa)\.?\s+/,'travessa ').replace(/^(?:al|alameda)\.?\s+/,'alameda ').replace(/^(?:pc|praca)\.?\s+/,'praca ').replace(/\b(?:d[aeo]s?)\b/g,' ').replace(/\s+/g,' ').trim();
 return {street,number:m[2]?.replace('/','').replace(/^0+(?=\d)/,'')};
}
export const sameFieldValue=(key:string,a:string,b:string)=>{
 if(canonicalFieldValue(key,a)===canonicalFieldValue(key,b))return true;
 if(key!=='endereco')return false;
 const x=addressParts(a),y=addressParts(b);
 // Same street; numbers must agree whenever both sources state one.
 return !!x&&!!y&&x.street===y.street&&(!x.number||!y.number||x.number===y.number);
};
export const distinctFieldValues=(key:string,values:string[])=>values.filter((value,index)=>values.findIndex(other=>sameFieldValue(key,value,other))===index);
