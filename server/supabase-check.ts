import "dotenv/config";
import postgres from "postgres";
import {supabaseConfig} from "./supabase-config.js";
/** Connectivity probe only: no migration, bucket creation or data write. */
async function main(){
 const c=supabaseConfig(),sql=postgres(c.connection,{ssl:c.ssl,max:1,connect_timeout:10,idle_timeout:2,onnotice:()=>{}});
 try {
  await sql.begin("read only",async tx=>{
   const [settings]=await tx`SELECT current_setting('transaction_read_only') AS read_only`;
   if(settings.read_only!=="on")throw Error("A verificação deve executar em transação somente leitura.");
   // The client requires verified TLS. pg_stat_ssl only describes the backend connection behind the pooler.
  });
  console.log("PostgreSQL acessível com TLS verificado; consulta somente leitura concluída.");
  if(c.key){
   const response=await fetch(c.project+"/storage/v1/bucket/"+c.bucket,{headers:{apikey:c.key,Authorization:"Bearer "+c.key},signal:AbortSignal.timeout(10000)});
   if(!response.ok)throw Error("Não foi possível consultar o bucket privado. Confira o projeto, as permissões e a criação do bucket.");
   const bucket=await response.json();if(bucket.public!==false)throw Error("O bucket de documentos precisa ser privado.");
   console.log("Bucket encontrado e confirmado como privado.");
  }else console.log("Storage não verificado: SUPABASE_SECRET_KEY ainda não configurada.");
  console.log("Este teste não ativa Supabase no portal. O adaptador de persistência e a migração ainda precisam ser concluídos e validados.");
 }finally{await sql.end({timeout:3});}
}
main().catch((error: unknown)=>{
 const code=(error as {code?:string})?.code;
 const reason=code==="28P01"?"O PostgreSQL recusou a autenticação. Confira o usuário e a senha da URI.":
  code==="ENOTFOUND"?"O endereço do banco não foi encontrado. Confira o host e o DNS.":
  "Confira as variáveis, o certificado TLS, a rede e as permissões.";
 console.error("Supabase não validado. "+reason);
 process.exitCode=1;
});
