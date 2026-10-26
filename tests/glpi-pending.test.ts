import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RealGlpiSource,glpiConfig,ticketHash} from '../server/glpi.js';
import {isGlpiPending,glpiPriorityLabel,glpiPriorityRank,matchesDemandQueue,demandPriorityRank} from '../shared/glpi-ticket-meta.js';

function fixture(wrongStatus=false,previous:string[]=[],includeOpen=false,emptyStatus=false){
 const calls:{path:string;method:string}[]=[];
 const fetcher:typeof fetch=async(input,init)=>{
  const u=new URL(String(input)),path=u.pathname.replace('/apirest.php/','');calls.push({path,method:init?.method||'GET'});
  const out=(body:any,headers={})=>new Response(JSON.stringify(body),{headers});
  if(path==='initSession')return out({session_token:'fake'});
  if(path==='killSession')return out(true);
  if(path==='Group/21')return out({name:'Jurídico'});
  if(path==='Group/21/Group_Ticket')return out([{tickets_id:100,groups_id:21,type:2}],{'Content-Range':'0-0/1'});
  if(path==='listSearchOptions/Ticket')return out({'2':{table:'glpi_tickets',field:'id'},'12':{table:'glpi_tickets',field:'status'}});
  if(path==='search/Ticket'){
   const status=Number(u.searchParams.get('criteria[0][value]'));
   if(emptyStatus && status===3)return out({totalcount:0,count:0});
   const rows=status===4?[{'2':10,'12':wrongStatus?2:4},{'2':9,'12':4},{'2':8,'12':4}]:status===1?Array.from({length:7},(_,i)=>({'2':20+i,'12':1})):[{'2':status===2?30:40,'12':status}];
   const [start,end]=u.searchParams.get('range')!.split('-').map(Number);
   return out({totalcount:rows.length,data:rows.slice(start,end+1)});
  }
  const links=/^Ticket\/(\d+)\/Group_Ticket$/.exec(path);
  if(links)return out([{tickets_id:Number(links[1]),groups_id:links[1]==='9'?99:21,type:links[1]==='8'?3:2}]);
  const t=/^Ticket\/(\d+)$/.exec(path);
  if(t)return out({id:Number(t[1]),name:'Fictício',status:t[1]==='10'?4:Number(t[1])>=20&&Number(t[1])<=26?1:t[1]==='40'?3:2,priority:5});
  if(/^Ticket\/\d+\/(ITILFollowup|Document_Item)$/.test(path))return out([]);
  throw Error('Recurso inesperado '+path);
 };
 const config=glpiConfig({GLPI_URL:'https://fake.local/apirest.php',GLPI_APP_TOKEN:'fake',GLPI_USER_TOKEN:'fake',GLPI_GROUP_IDS:'21',GLPI_GROUPS:'',GLPI_INCLUDE_PENDING:'true',GLPI_INCLUDE_OPEN:String(includeOpen),GLPI_MAX_TICKETS:'1',GLPI_PAGE_SIZE:'5',GLPI_RETRIES:'0'});
 return {source:new RealGlpiSource(config,fetcher,previous),calls};
}
test('Pendentes antigos têm cota própria, prioridade original e validação de grupo/tipo de ator',async()=>{
 const {source,calls}=fixture();const tickets=await source.read(AbortSignal.timeout(10000));
 assert.deepEqual(tickets.map(t=>t.externalId),['100','10']);assert.equal(tickets[1].priority,'5');
 assert.ok(calls.every(c=>c.method==='GET'));assert.equal(calls.at(-1)?.path,'killSession');
 assert.ok(!calls.some(c=>['Ticket/9','Ticket/8'].includes(c.path)));
});
test('Resposta fora do filtro pendente interrompe importação e fecha sessão',async()=>{
 const {source,calls}=fixture(true);await assert.rejects(source.read(AbortSignal.timeout(10000)),/não respeitou/);
 assert.equal(calls.at(-1)?.path,'killSession');
});
test('Chamado antigo que deixou de ser pendente é consultado para atualizar status local',async()=>{
 const {source}=fixture(false,['7']);const tickets=await source.read(AbortSignal.timeout(10000));
 assert.equal(tickets.find(t=>t.externalId==='7')?.status,'2');
});
test('Importa todas as páginas dos novos e em atendimento sem cortar pelo limite de recentes',async()=>{
 const {source,calls}=fixture(false,[],true);const tickets=await source.read(AbortSignal.timeout(10000));
 assert.equal(tickets.length,11);assert.equal(tickets.filter(t=>t.status==='1').length,7);
 assert.ok(tickets.some(t=>t.externalId==='30'));assert.ok(tickets.some(t=>t.externalId==='40'));
 assert.ok(calls.every(c=>c.method==='GET'));assert.equal(new Set(tickets.map(t=>t.externalId)).size,11);
});
test('Abas de Demandas separam status de origem sem ocultar manuais ou encerrados em Todas',()=>{
 for(const status of ['1','2','3']){assert.equal(matchesDemandQueue({glpiOrigin:{status}},'open'),true);assert.equal(matchesDemandQueue({glpiOrigin:{status}},'pending'),false);}
 assert.equal(matchesDemandQueue({glpiOrigin:{status:'4'}},'pending'),true);
 for(const d of [{glpiOrigin:null},{glpiOrigin:{status:'5'}},{glpiOrigin:{status:'6'}}]){assert.equal(matchesDemandQueue(d,'all'),true);assert.equal(matchesDemandQueue(d,'open'),false);assert.equal(matchesDemandQueue(d,'pending'),false);}
});
test('Status sem resultados pode omitir data sem interromper a leitura dos demais status',async()=>{
 const {source}=fixture(false,[],true,true);const tickets=await source.read(AbortSignal.timeout(10000));
 assert.equal(tickets.length,10);assert.equal(tickets.some(t=>t.status==='3'),false);
});
test('Status GLPI e prioridade não são confundidos com correção documental ou prioridade local',()=>{
 assert.equal(isGlpiPending('4'),true);assert.equal(isGlpiPending('2'),false);
 assert.equal(glpiPriorityLabel('3'),'Média');assert.equal(glpiPriorityRank('6'),6);assert.equal(glpiPriorityLabel(undefined),'Prioridade não informada');
 const base:any={title:'Teste',status:'4',priority:'3',content:'',followups:[],documents:[],groups:[]};
 assert.notEqual(ticketHash(base),ticketHash({...base,priority:'4'}));
});
test('Prioridade ordena crítica, urgente local, alta, média, baixa e desconhecida',()=>{
 const rows=[{glpiOrigin:{priority:'1'}},{glpiOrigin:{priority:'3'}},{priority:'Urgente'},{glpiOrigin:{priority:'6'}},{priority:'Alta'},{glpiOrigin:{priority:''}}];
 assert.deepEqual(rows.sort((a,b)=>demandPriorityRank(b)-demandPriorityRank(a)).map(demandPriorityRank),[6,6,4,3,1,0]);
});
