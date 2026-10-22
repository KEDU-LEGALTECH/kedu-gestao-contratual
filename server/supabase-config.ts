import {readFileSync} from "node:fs";
export function supabaseConfig(env:NodeJS.ProcessEnv=process.env) {
 if(!env.SUPABASE_URL || !env.SUPABASE_DATABASE_URL)throw Error("Configure SUPABASE_URL e SUPABASE_DATABASE_URL somente no ambiente do servidor.");
 let project:URL,database:URL;
 try{project=new URL(env.SUPABASE_URL);database=new URL(env.SUPABASE_DATABASE_URL);}catch{throw Error("Endereço Supabase ou conexão PostgreSQL inválidos. Não imprima a conexão com senha.");}
 const ref=project.hostname.split(".")[0];
 if(project.protocol!=="https:" || !/^[a-z0-9]+\.supabase\.co$/.test(project.hostname) || project.username || project.password || project.search || project.hash || project.pathname!=="/")throw Error("SUPABASE_URL deve ser a URL HTTPS do projeto hospedado no Supabase.");
 if(!["postgres:","postgresql:"].includes(database.protocol) || !database.username || !database.password)throw Error("Use a conexão PostgreSQL autenticada fornecida no painel Connect.");
 const direct=database.hostname===`db.${ref}.supabase.co`,pooler=database.hostname.endsWith(".pooler.supabase.com") && decodeURIComponent(database.username).endsWith("."+ref);
 if(!direct && !pooler)throw Error("A conexão PostgreSQL deve pertencer ao mesmo projeto Supabase informado.");
 if(database.port && !["5432","6543"].includes(database.port))throw Error("Porta PostgreSQL não reconhecida.");
 for(const [key,value] of database.searchParams)if(key!=="sslmode" || value!=="verify-full")throw Error("Use verify-full na conexão e informe o certificado separadamente em SUPABASE_CA_PATH.");
 database.search="";
 const ca=env.SUPABASE_CA_PATH?readFileSync(env.SUPABASE_CA_PATH,"utf8"):undefined;
 const bucket=env.SUPABASE_STORAGE_BUCKET||"kedu-documentos";
 if(!/^[a-z0-9][a-z0-9-]{2,62}$/.test(bucket))throw Error("Nome do bucket inválido.");
 return {project:project.origin,connection:database.toString(),ssl:{rejectUnauthorized:true,servername:database.hostname,...(ca?{ca}:{})},bucket,key:env.SUPABASE_SECRET_KEY||""};
}
