const statuses:Record<string,string>={"1":"Novo","2":"Em atendimento (atribuído)","3":"Em atendimento (planejado)","4":"Pendente","5":"Solucionado","6":"Fechado"};
const priorities:Record<string,string>={"1":"Muito baixa","2":"Baixa","3":"Média","4":"Alta","5":"Muito alta","6":"Crítica"};
export const glpiStatusLabel=(value:unknown)=>statuses[String(value)]||"Status não informado";
export const glpiPriorityLabel=(value:unknown)=>priorities[String(value)]||"Prioridade não informada";
export const isGlpiPending=(value:unknown)=>String(value)==="4";
export type DemandQueue="all"|"open"|"pending";
export const matchesDemandQueue=(d:{glpiOrigin?:{status?:unknown}|null},queue:DemandQueue)=>queue==="all" || (queue==="pending"?isGlpiPending(d.glpiOrigin?.status):["1","2","3"].includes(String(d.glpiOrigin?.status)));
export const glpiPriorityRank=(value:unknown)=>priorities[String(value)]?Number(value):0;
export const demandPriorityRank=(d:{glpiOrigin?:{priority?:unknown}|null;priority?:string})=>d.glpiOrigin?glpiPriorityRank(d.glpiOrigin.priority):({Urgente:6,Alta:4,Normal:3}[d.priority||""]||0);
