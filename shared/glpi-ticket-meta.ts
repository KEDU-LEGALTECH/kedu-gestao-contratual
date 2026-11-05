const statuses:Record<string,string>={"1":"Novo","2":"Em atendimento (atribuído)","3":"Em atendimento (planejado)","4":"Pendente","5":"Solucionado","6":"Fechado"};
const priorities:Record<string,string>={"1":"Muito baixa","2":"Baixa","3":"Média","4":"Alta","5":"Muito alta","6":"Crítica"};
export const glpiStatusLabel=(value:unknown)=>statuses[String(value)]||"Status não informado";
export const glpiPriorityLabel=(value:unknown)=>priorities[String(value)]||"Prioridade não informada";
export const isGlpiPending=(value:unknown)=>String(value)==="4";
export const isGlpiSolved=(value:unknown)=>String(value)==="5";
export const isGlpiClosed=(value:unknown)=>String(value)==="6";
type DemandOrigin={stage?:string;glpiOrigin?:{status?:unknown}|null};
export const isOpenDemand=(d:DemandOrigin)=>!['Concluído','Cancelado'].includes(d.stage||'') && !['5','6'].includes(String(d.glpiOrigin?.status));
/** Single stage label for lists and reports: a ticket ended in GLPI is not an active pending item.
 * The reading status stays available in `processing`; a final internal stage takes precedence. */
export const demandDisplayStage=(d:DemandOrigin&{processing?:{status?:string}|null})=>{
 if(['Concluído','Cancelado','Em assinatura'].includes(d.stage||''))return d.stage!;
 if(isGlpiSolved(d.glpiOrigin?.status))return "Solucionado no GLPI";
 if(isGlpiClosed(d.glpiOrigin?.status))return "Fechado no GLPI";
 return d.processing?.status||d.stage||'';
};
export type DemandQueue="all"|"active"|"open"|"pending"|"solved"|"closed";
export const matchesDemandQueue=(d:DemandOrigin,queue:DemandQueue)=>queue==="all" || (queue==="active"?isOpenDemand(d):queue==="pending"?isGlpiPending(d.glpiOrigin?.status):queue==="solved"?isGlpiSolved(d.glpiOrigin?.status):queue==="closed"?isGlpiClosed(d.glpiOrigin?.status):["1","2","3"].includes(String(d.glpiOrigin?.status)));
export const glpiPriorityRank=(value:unknown)=>priorities[String(value)]?Number(value):0;
export const demandPriorityRank=(d:{glpiOrigin?:{priority?:unknown}|null;priority?:string})=>d.glpiOrigin?glpiPriorityRank(d.glpiOrigin.priority):({Urgente:6,Alta:4,Normal:3}[d.priority||""]||0);
