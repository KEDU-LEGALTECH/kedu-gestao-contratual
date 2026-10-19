import "dotenv/config";
import { z } from "zod";
import { db, one, run, id, hash, audit } from "./db.js";
const admin = z.object({
  name: z.string().trim().min(3),
  email: z.email().refine(value => !value.endsWith("@demo.kedu.local"), "Use um e-mail real."),
  password: z.string().min(16).refine(value => value !== "Kedu-demo-2026!", "Não use a senha demonstrativa."),
}).parse({name: process.env.ADMIN_NAME, email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD});
if (one("SELECT id FROM users LIMIT 1")) throw Error("Preparação inicial permitida somente em banco sem usuários.");
const userId = id();
run("INSERT INTO users VALUES(?,?,?,?,?)", userId, admin.name, admin.email, "Administrador", hash(admin.password));
audit(null, userId, "Administrador inicial provisionado localmente");
db.close();
console.log("Administrador inicial criado. Remova ADMIN_PASSWORD do ambiente após a preparação.");
