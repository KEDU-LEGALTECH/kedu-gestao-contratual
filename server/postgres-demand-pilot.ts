import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import express, { type Request } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import type postgres from "postgres";
import { ZodError } from "zod";
import { access, permissions, redactDemandData } from "../shared/access-policy.js";
import { createPostgresDemand, updatePostgresDemand } from "./postgres-demand-writes.js";

type User = { id: string; name: string; role: string; email: string; password: string };
type SessionRequest = Request & { user?: User };
type Sql = postgres.Sql | postgres.TransactionSql;
const sessionDuration = 8 * 60 * 60 * 1000;
const identity = ({ id, name, role }: User) => ({ id, name, role, permissions: permissions[role] });

function validPassword(password: string, stored: string) {
  const [salt, key] = stored.split(":");
  if (!/^[a-f0-9]{32}$/i.test(salt ?? "") || !/^[a-f0-9]{128}$/i.test(key ?? "")) return false;
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(key, "hex"));
}

/** Isolated PostgreSQL routes for the first migration phase. Never starts a scheduler. */
export function createPostgresDemandPilot(sql: Sql, secureCookies = true) {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(express.json({ limit: "16kb" }));
  app.use(cookieParser());
  app.use("/api", (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  app.post("/api/login", rateLimit({ windowMs: 900000, limit: 20 }), async (req, res) => {
    const { email, password } = req.body ?? {};
    const denied = () => res.status(401).json({ error: "E-mail ou senha inválidos." });
    if (typeof email !== "string" || typeof password !== "string" || password.length > 1024) {
      denied();
      return;
    }
    const [user] = await sql<User[]>`SELECT id, name, role, email, password FROM users WHERE email=${email}`;
    if (!user || !Object.hasOwn(permissions, user.role) ||
        (secureCookies && user.email.endsWith("@demo.kedu.local")) || !validPassword(password, user.password)) {
      denied();
      return;
    }
    const token = randomBytes(32).toString("hex");
    await sql`INSERT INTO sessions (token,user_id,expires) VALUES (${token},${user.id},${Date.now() + sessionDuration})`;
    res.cookie("session", token, { httpOnly: true, sameSite: "strict", secure: secureCookies, maxAge: sessionDuration });
    res.json(identity(user));
  });
  app.use("/api", async (req: SessionRequest, res, next) => {
    const token = req.cookies.session;
    const [user] = typeof token === "string" && /^[a-f0-9]{64}$/.test(token)
      ? await sql<User[]>`SELECT u.id,u.name,u.role,u.email FROM sessions s JOIN users u ON u.id=s.user_id
          WHERE s.token=${token} AND s.expires>${Date.now()}`
      : [];
    if (!user || !Object.hasOwn(permissions,user.role)) {
      res.status(401).json({ error: "Entre na sua conta para continuar." });
      return;
    }
    req.user = user;
    next();
  });
  app.get("/api/me", (req: SessionRequest, res) => { res.json(identity(req.user!)); });
  app.post("/api/logout", async (req, res) => {
    await sql`DELETE FROM sessions WHERE token=${req.cookies.session}`;
    res.clearCookie("session", { httpOnly: true, sameSite: "strict", secure: secureCookies });
    res.json({ ok: true });
  });
  app.get("/api/demands", async (req: SessionRequest, res) => {
    const user = req.user!;
    const owner = user.role === "Solicitante" ? user.id : null;
    const rows = await sql`SELECT d.*, s.name AS registered_school, s.cnpj,
        COALESCE(u.name,'Não atribuído') AS owner_name, t.status AS glpi_status, t.payload AS glpi_payload
      FROM demands d LEFT JOIN schools s ON s.id=d.school_id LEFT JOIN users u ON u.id=d.owner
      LEFT JOIN glpi_tickets t ON t.external_id=d.glpi_id
      WHERE (${owner}::text IS NULL OR d.owner=${owner}) ORDER BY d.created DESC,d.id`;
    res.json(rows.map(({ registered_school, glpi_status, glpi_payload, ...demand }) => {
      const data = JSON.parse(demand.data);
      const priority = glpi_payload ? JSON.parse(glpi_payload).priority : undefined;
      return {
        ...demand,
        school: registered_school ?? data.razaoSocial ?? "Organização a identificar",
        data_version: Number(demand.data_version),
        confirmed: Number(demand.confirmed),
        glpiOrigin: glpi_status ? { status: glpi_status, priority } : null,
        data: redactDemandData(user, data),
      };
    }));
  });
  app.post("/api/demands", async (req: SessionRequest, res) => {
    res.json({ id: await createPostgresDemand(sql, req.user!, req.body) });
  });
  app.get("/api/demands/:id", async (req: SessionRequest, res) => {
    const [demand] = await sql`SELECT * FROM demands WHERE id=${req.params.id}`;
    if (!demand) { res.status(404).json({ error: "Demanda não encontrada." }); return; }
    access(req.user!, demand);
    const history = await sql`SELECT a.id,a.action,a.created,u.name FROM audit a
      LEFT JOIN users u ON u.id=a.user_id WHERE a.demand_id=${demand.id} ORDER BY a.created DESC,a.id`;
    res.json({ ...demand, data_version: Number(demand.data_version), confirmed: Number(demand.confirmed),
      data: redactDemandData(req.user!, JSON.parse(demand.data)), history });
  });
  app.put("/api/demands/:id/data", async (req: SessionRequest, res) => {
    await updatePostgresDemand(sql, req.user!, String(req.params.id), req.body ?? {});
    res.json({ ok: true });
  });
  app.use("/api", (_req, res) => { res.status(404).json({ error: "Rota indisponível neste ensaio." }); });
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof ZodError) {
      res.status(400).json({ error: "Dados inválidos ou operação ainda indisponível neste ensaio." });
      return;
    }
    if (error instanceof Error && "status" in error && [400,403,404,409].includes(Number(error.status))) {
      res.status(Number(error.status)).json({ error:error.message, ...("fields" in error ? {fields:error.fields} : {}) });
      return;
    }
    res.status(500).json({ error: "Não foi possível concluir a solicitação." });
  });
  return app;
}
