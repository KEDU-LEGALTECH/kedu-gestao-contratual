import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RealGlpiSource,glpiConfig,GlpiClient} from '../server/glpi.js';

test('status search filters authorized assigned groups before paging and still checks membership',async()=>{
 let search:URL|undefined,membership=0;
 const fetcher:typeof fetch=async(input)=>{
  const url=new URL(String(input));const path=url.pathname.replace('/apirest.php/','');let body:any;
  if(path==='initSession')body={session_token:'test-session'};
  else if(path==='killSession')body=true;
  else if(/^Group\/\d+$/.test(path))body={id:Number(path.split('/')[1]),name:'Grupo '+path};
  else if(/^Group\/\d+\/Group_Ticket$/.test(path))body=[];
  else if(path==='listSearchOptions/Ticket')body={1:{table:'glpi_tickets',field:'id'},12:{table:'glpi_tickets',field:'status'},888:{table:'glpi_groups',field:'completename',name:'Grupo técnico'}};
  else if(path==='search/Ticket'){search=url;body={data:[{1:99,12:4}],totalcount:1,count:1};}
  else if(path==='Ticket/99/Group_Ticket'){membership++;body=[{tickets_id:99,groups_id:21,type:2}];}
  else if(path==='Ticket/99')body={id:99,name:'Chamado de teste',status:4};
  else if(/ITILFollowup|Document_Item/.test(path))body=[];
  else throw Error('Consulta inesperada: '+path);
  return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
 };
 const config=glpiConfig({GLPI_URL:'http://localhost/apirest.php',GLPI_APP_TOKEN:'test-app',GLPI_USER_TOKEN:'test-user',GLPI_GROUPS:'',GLPI_GROUP_IDS:'21;22',GLPI_INCLUDE_PENDING:'true'});
 const tickets=await new RealGlpiSource(config,fetcher).read(AbortSignal.timeout(2000));
 assert.equal(tickets.length,1);assert.equal(membership,1);
 assert.equal(search!.searchParams.get('criteria[1][criteria][0][field]'),'888');
 assert.equal(search!.searchParams.get('criteria[1][criteria][0][value]'),'21');
 assert.equal(search!.searchParams.get('criteria[1][criteria][1][value]'),'22');
 assert.equal(search!.searchParams.get('criteria[1][criteria][1][link]'),'OR');
 assert.equal(search!.searchParams.get('criteria[1][link]'),'AND');
});

test('network failure identifies the consultation and safe cause without exposing tokens',async()=>{
 const config=glpiConfig({GLPI_URL:'http://localhost/apirest.php',GLPI_APP_TOKEN:'secret-app',GLPI_USER_TOKEN:'secret-user',GLPI_RETRIES:'0'});
 const client=new GlpiClient(config,async()=>{throw Object.assign(new TypeError('fetch failed'),{cause:{code:'ENOTFOUND'}});});
 await assert.rejects(client.open(),e=>{assert.match(String(e),/initSession/);assert.match(String(e),/ENOTFOUND/);assert.doesNotMatch(String(e),/secret-app|secret-user/);return true;});
});
