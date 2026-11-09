import "dotenv/config";
import {lookup} from "node:dns/promises";
import {GlpiClient,glpiConfig,configProblems} from "./glpi.js";
/** Read-only probe to run on a candidate server: can this machine reach and read the GLPI?
 * Opens one API session, reads the configured groups and one ticket link, and closes the session.
 * Never prints tokens, never writes to the GLPI and does not open the Kedu database. */
const config=glpiConfig();
const step=async(label:string,task:()=>Promise<string>)=>{
 const started=Date.now();
 try{const detail=await task();console.log(`OK    ${label} (${((Date.now()-started)/1000).toFixed(1)} s)${detail?" — "+detail:""}`);return true;}
 catch(error:any){console.log(`FALHA ${label} (${((Date.now()-started)/1000).toFixed(1)} s) — ${explain(error)}`);return false;}
};
function explain(error:any){
 const text=String(error?.message||error),code=/\b(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ECONNRESET|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET|CERT_\w+|UNABLE_TO_\w+|SELF_SIGNED\w*|DEPTH_ZERO\w*)\b/.exec(text+" "+(error?.code||""))?.[1];
 if(code==="ENOTFOUND"||code==="EAI_AGAIN")return "o nome do servidor do GLPI não foi encontrado. Esta máquina provavelmente está fora da rede ou VPN da empresa, ou o DNS interno não está disponível.";
 if(code==="ECONNREFUSED")return "o servidor do GLPI recusou a conexão. Confira porta, firewall e se o endereço está certo.";
 if(code&&/TIMEOUT|ETIMEDOUT/.test(code)||/Tempo limite/.test(text))return "sem resposta dentro do prazo. Pode ser firewall, rota de rede ou VPN.";
 if(code&&/CERT|UNABLE_TO|SELF_SIGNED|DEPTH_ZERO/.test(code))return "o certificado HTTPS do GLPI não foi aceito por esta máquina. O TI precisa instalar a cadeia de certificados da empresa.";
 if(/\b401\b|ERROR_SESSION_TOKEN|ERROR_LOGIN|ERROR_APP_TOKEN|ERROR_WRONG_APP_TOKEN/i.test(text))return "o GLPI respondeu, mas recusou os tokens. Confira GLPI_APP_TOKEN, GLPI_USER_TOKEN e se o App-Token aceita o IP desta máquina.";
 if(/\b403\b|ERROR_RIGHT_MISSING/.test(text))return "o GLPI respondeu, mas o perfil do token não tem permissão de leitura para este item.";
 return text.replace(/https?:\/\/\S+/g,"[url]").slice(0,240);
}
async function main(){
 console.log("Teste de acesso ao GLPI (somente leitura). Nenhum token é exibido e nada é gravado.");
 const problems=configProblems(config);
 if(problems.length){console.log("FALHA configuração — "+problems.join("; "));process.exitCode=1;return;}
 const host=new URL(config.url).hostname;
 const dns=await step("nome do servidor ("+host+")",async()=>{const r=await lookup(host);return "endereço "+(r.family===6?"IPv6":"IPv4")+" encontrado";});
 if(!dns){process.exitCode=1;return;}
 const client=new GlpiClient(config);
 const signal=AbortSignal.timeout(Math.max(30000,config.timeoutMs*3));
 if(!await step("abertura da sessão",async()=>{await client.open(signal);return "tokens aceitos";})){process.exitCode=1;return;}
 let ok=true;
 try{
  const groups=[...config.groupIds];
  for(const name of config.groups)if(!groups.length)for(const g of await client.list("Group",{"searchText[name]":name},200,signal))if(g.name===name||g.completename===name)groups.push(Number(g.id));
  ok=await step("grupos autorizados",async()=>{if(!groups.length)throw Error("Nenhum grupo configurado foi encontrado com este token.");for(const id of groups)await client.get(`Group/${id}`,{},signal);return groups.length+" grupo(s) acessível(is)";})&&ok;
  ok=await step("leitura de chamados dos grupos",async()=>{let total=0;for(const id of groups){const {range}=await client.get(`Group/${id}/Group_Ticket`,{range:"0-0"},signal);total+=Number(/\/(\d+)$/.exec(range)?.[1]||0);}return total+" vínculo(s) de chamado visível(is)";})&&ok;
 }finally{
  await step("encerramento da sessão",async()=>{await client.close();return "";});
 }
 console.log(ok?"RESULTADO: esta máquina consegue sincronizar com o GLPI.":"RESULTADO: o acesso ao GLPI está incompleto nesta máquina. Veja as falhas acima.");
 if(!ok)process.exitCode=1;
}
main().catch(error=>{console.log("FALHA inesperada — "+explain(error));process.exitCode=1;});
