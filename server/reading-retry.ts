export type ReadingRetry={attempts:number;at:string};
export function partialReadingRetryDue(partial:boolean,last:ReadingRetry|undefined,time=Date.now()) {
 return partial&&(!last||(last.attempts<3&&time-Date.parse(last.at)>=10*60000));
}
