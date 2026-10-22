import "dotenv/config";
import {DatabaseSync} from "node:sqlite";
import {existsSync} from "node:fs";
import {backupInterval} from "./backup-service.js";
import {supabaseConfig} from "./supabase-config.js";
const db=new DatabaseSync(process.env.DATABASE_PATH||"data/kedu.sqlite",{readOnly:true});
const issues:string[]=[];
try{
 if((db.prepare("PRAGMA integrity_check").get() as any).integrity_check!=="ok" || db.prepare("PRAGMA foreign_key_check").all().length)issues.push("Integridade do banco local precisa ser corrigida.");
 const models=(db.prepare("SELECT count(*) n FROM template_sources s JOIN template_versions v ON v.id=s.version_id LEFT JOIN template_homologations h ON h.version_id=v.id LEFT JOIN inactive_template_versions i ON i.version_id=v.id WHERE i.version_id IS NULL AND (h.version_id IS NULL OR h.template_hash<>s.template_hash OR v.status<>'aprovado')").get() as any).n;
 if(models)issues.push(`${models} versões oficiais ainda dependem de homologação jurídica.`);
 const accounts=(db.prepare("SELECT count(*) n FROM users WHERE email NOT LIKE '%@demo.kedu.local'").get() as any).n;
 if(!accounts)issues.push("Criar contas reais individuais antes da publicação.");
 if(process.env.DEMO_SEED!=="false")issues.push("Definir DEMO_SEED=false na implantação.");
 if(!existsSync("dist/index.html"))issues.push("Executar npm run build.");
 try{if(!backupInterval())issues.push("Habilitar backups automáticos e cópia externa na implantação.");}catch{issues.push("Intervalo de backup inválido.");}
 try{supabaseConfig();}catch{issues.push("Aguardando configuração válida de projeto e conexão Supabase no servidor.");}
 issues.push("Adaptador de persistência PostgreSQL/Storage e migração real ainda não concluídos; runtime atual usa SQLite.");
 const origins=(process.env.ALLOWED_ORIGINS||"").split(",").filter(Boolean);
 if(!origins.length || origins.some(x=>!x.startsWith("https://")))issues.push("Configurar domínio HTTPS e ALLOWED_ORIGINS exato.");
 console.log(JSON.stringify({database:"sqlite",readyForTeam:issues.length===0,issues},null,2));
 if(issues.length)process.exitCode=2;
}finally{db.close();}
