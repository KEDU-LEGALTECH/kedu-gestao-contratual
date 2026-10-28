export async function withinBudget<T>(task:()=>Promise<T>,milliseconds:number,onTimeout:()=>void):Promise<T> {
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([task(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{onTimeout();reject(Error('Tempo de leitura desta página excedido.'));},milliseconds);})]);}
 finally{clearTimeout(timer);}
}
