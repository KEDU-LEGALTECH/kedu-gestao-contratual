export const scheduleTimezone = 'America/Sao_Paulo';
export function dailySyncTimes(value = process.env.GLPI_SYNC_TIMES || '') {
  const times = value.split(',').map(s => s.trim()).filter(Boolean);
  if (times.some(s => !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s))) throw Error('GLPI_SYNC_TIMES deve conter horários HH:mm separados por vírgula.');
  return [...new Set(times)].sort();
}
export function scheduledSlot(date: Date, times: string[]) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone:scheduleTimezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p => [p.type,p.value]));
  const time = `${parts.hour}:${parts.minute}`;
  return times.includes(time) ? `${parts.year}-${parts.month}-${parts.day}T${time}` : null;
}
/** Latest due run; one catch-up replaces missed slots while the server was off. */
export function latestDueSlot(date:Date,times:string[]) {
 if(!times.length)return null;
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:scheduleTimezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
 const day=`${parts.year}-${parts.month}-${parts.day}`,time=`${parts.hour}:${parts.minute}`;
 const due=[...times].sort().filter(t=>t<=time).at(-1);
 if(due)return `${day}T${due}`;
 const previous=new Date(day+'T12:00:00Z');previous.setUTCDate(previous.getUTCDate()-1);
 return previous.toISOString().slice(0,10)+'T'+[...times].sort().at(-1);
}
