import assert from "node:assert/strict";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import type postgres from "postgres";
import { createPostgresDemandPilot } from "../server/postgres-demand-pilot.js";

export async function checkPostgresDemandPilot(sql: postgres.TransactionSql) {
  const suffix = randomUUID();
  const password = randomBytes(20).toString("hex");
  const salt = randomBytes(16).toString("hex");
  const hash = salt + ":" + scryptSync(password, salt, 64).toString("hex");
  const requester = "requester-" + suffix;
  const operator = "operator-" + suffix;
  const requesterEmail = requester + "@example.test";
  const operatorEmail = operator + "@example.test";
  await sql`INSERT INTO users (id,name,email,role,password) VALUES
    (${requester},'Solicitante de teste',${requesterEmail},'Solicitante',${hash}),
    (${operator},'Operador de teste',${operatorEmail},'Operação',${hash})`;
  const demandData = JSON.stringify({ razaoSocial: "Escola de teste", conta: "CONTA-TESTE", anteriorConta: "CONTA-ANTIGA" });
  const requesterDemand = "demand-a-" + suffix;
  const operatorDemand = "demand-b-" + suffix;
  const ticket = "ticket-" + suffix;
  await sql`INSERT INTO demands (id,glpi_id,type,stage,priority,owner,due,data,created) VALUES
    (${requesterDemand},${ticket},'Aditivo','Recebido','Normal',${requester},'',${demandData},'2026-01-01'),
    (${operatorDemand},NULL,'Aditivo','Recebido','Normal',${operator},'',${demandData},'2026-01-01')`;
  await sql`INSERT INTO glpi_tickets (external_id,mode,title,status,hash,payload,analysis,state,first_seen,last_seen)
    VALUES (${ticket},'demo','Teste','2','teste','{"priority":3}','{}','novo','2026-01-01','2026-01-01')`;

  const server = createPostgresDemandPilot(sql, false).listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address();
    assert(address && typeof address === "object");
    const url = "http://127.0.0.1:" + address.port;
    const login = (email: string, pwd: string) => fetch(url + "/api/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: pwd }),
    });
    const cookie = (response: Response) => {
      assert.equal(response.status, 200);
      const value = response.headers.get("set-cookie") ?? "";
      assert.match(value, /HttpOnly/i);
      assert.match(value, /SameSite=Strict/i);
      return value.split(";")[0];
    };
    assert.equal((await fetch(url + "/api/demands")).status, 401);
    assert.equal((await login(requesterEmail, "incorreta")).status, 401);
    const requesterCookie = cookie(await login(requesterEmail, password));
    const requesterHeaders = { Cookie: requesterCookie };
    const me = await fetch(url + "/api/me", { headers: requesterHeaders });
    assert.deepEqual((await me.json()).permissions, ["write"]);
    const requesterList = await fetch(url + "/api/demands", { headers: requesterHeaders });
    assert.equal(requesterList.status, 200);
    const visible = await requesterList.json();
    assert.deepEqual(visible.map((d: { id: string }) => d.id), [requesterDemand]);
    assert.equal(visible[0].data.conta, undefined);
    assert.equal(visible[0].data.anteriorConta, undefined);
    assert.equal(visible[0].school, "Escola de teste");
    assert.deepEqual(visible[0].glpiOrigin, { status: "2", priority: 3 });

    const operatorCookie = cookie(await login(operatorEmail, password));
    const operatorList = await fetch(url + "/api/demands", { headers: { Cookie: operatorCookie } });
    assert.equal(operatorList.status, 200);
    const operatorRows = await operatorList.json();
    assert.equal(operatorRows.find((d: { id: string }) => d.id === operatorDemand)?.data.conta, "CONTA-TESTE");
    const school = "school-" + suffix;
    const [unique] = await sql`SELECT '00.000.000/0001-' || lpad(n::text,2,'0') AS cnpj
      FROM generate_series(1,99) AS n
      WHERE NOT EXISTS (SELECT 1 FROM schools WHERE cnpj='00.000.000/0001-' || lpad(n::text,2,'0')) LIMIT 1`;
    await sql`INSERT INTO schools(id,name,legal_name,cnpj) VALUES(${school},'Escola de teste','ESCOLA TESTE LTDA',${unique.cnpj})`;
    const create = (session: string, type = "Contrato de garantia", extra = {}) => fetch(url + "/api/demands", {
      method:"POST",headers:{Cookie:session,"Content-Type":"application/json"},
      body:JSON.stringify({school_id:school,owner:operator,type,priority:"Normal",due:"2026-12-31",...extra}),
    });
    assert.equal((await create(requesterCookie)).status,403);
    assert.equal((await create(operatorCookie,"Aditivo")).status,400);
    const created = await create(operatorCookie);
    assert.equal(created.status,200);
    const {id} = await created.json();
    const getDetail = (session: string) => fetch(url + "/api/demands/" + id, {headers:{Cookie:session}});
    assert.equal((await getDetail(requesterCookie)).status,403);
    const detail = await getDetail(operatorCookie);
    assert.equal(detail.status,200);
    assert.equal((await detail.json()).data_version,1);
    const edit = (session: string, payload: Record<string,unknown>) => fetch(url + "/api/demands/" + id + "/data", {
      method:"PUT",headers:{Cookie:session,"Content-Type":"application/json"},body:JSON.stringify(payload),
    });
    assert.equal((await edit(requesterCookie,{expected_version:1,motivo:"Sem autorização"})).status,403);
    assert.equal((await edit(operatorCookie,{expected_version:1,matriz:"outra"})).status,400);
    assert.equal((await edit(operatorCookie,{expected_version:1,remuneracao:"101,00%"})).status,400);
    assert.equal((await edit(operatorCookie,{expected_version:1,motivo:"Conferência de teste",remuneracao:"7,70%",garantia:"10,00%",repasse:"20,00%",valor:"100,00"})).status,200);
    assert.equal((await edit(operatorCookie,{expected_version:1,motivo:"Versão antiga"})).status,409);
    const saved = await (await getDetail(operatorCookie)).json();
    assert.equal(saved.data_version,2);
    assert.equal(saved.stage,"Em elaboração");
    assert.equal(saved.data.motivo,"Conferência de teste");
    assert.equal(saved.history.length,2);
    const [terms] = await sql`SELECT remuneration_bps,reference_cents FROM commercial_terms WHERE demand_id=${id}`;
    assert.equal(Number(terms.remuneration_bps),770);
    assert.equal(Number(terms.reference_cents),10000);
    const matrix = saved.contract_id;
    await sql`UPDATE contracts SET status='Assinado' WHERE id=${matrix}`;
    const addendum = {matrix,subtype:"Vigência"};
    assert.equal((await create(operatorCookie,"Aditivo",addendum)).status,409);
    await sql`INSERT INTO signed_history(id,matrix_id,sequence,source,reference,signature_date,confirmed_by,created)
      VALUES(${randomUUID()},${matrix},3,'Clicksign','Teste','2026-01-01',${operator},'2026-01-01')`;
    const reserved = await create(operatorCookie,"Aditivo",addendum);
    assert.equal(reserved.status,200);
    const child = await reserved.json();
    const [sequence] = await sql`SELECT c.sequence FROM demands d JOIN contracts c ON c.id=d.contract_id WHERE d.id=${child.id}`;
    assert.equal(Number(sequence.sequence),4);
    assert.equal((await create(operatorCookie,"Aditivo",addendum)).status,409);
    assert.equal((await fetch(url + "/api/logout", { method: "POST", headers: requesterHeaders })).status, 200);
    assert.equal((await fetch(url + "/api/me", { headers: requesterHeaders })).status, 401);
    const token = operatorCookie.slice("session=".length);
    await sql`UPDATE sessions SET expires=0 WHERE token=${token}`;
    assert.equal((await fetch(url + "/api/me", { headers: { Cookie: operatorCookie } })).status, 401);
  } finally {
    await new Promise<void>(resolve => { server.close(() => resolve()); });
  }
  console.log("Login, permissões, demandas e reserva de aditivo validados em PostgreSQL por HTTP.");
}
