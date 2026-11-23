import React, { useEffect, useState } from "react";

import {
  LayoutDashboard,
  Files,
  FileCheck2,
  BookOpen,
  ChartNoAxesCombined,
  Settings,
  Plus,
  Search,
  ArrowUpRight,
  ChevronRight,
  RefreshCw,
  Check,
  Clock,
  TriangleAlert,
  ArrowLeft,
  Download,
  PanelLeftClose,
  LogOut,
  KeyRound,
  ShieldCheck,
  Inbox,
  FileText,
  Link2,
} from "lucide-react";
import "./style.css";
import "./theme.css";
import "./simple-demand.css";
import { ThemeToggle } from "./ThemeToggle";
import { AttachmentCheck } from "./AttachmentCheck";
import { SimpleDemand } from "./SimpleDemand";
import { contractStageActions } from "../shared/demand-report";
import { AccessRequests } from "./AccessRequests";
import { Reports } from "./Reports";
import { ProcessingSummary } from './ProcessingSummary';
import { ProcessingProgress } from './ProcessingProgress';
import { GovernancePanel, SignedHistoryPanel } from "./GovernancePanel";
import { requiredDataFields, validateData } from "../shared/data-validation";
import { bankFields } from "../shared/request-policy";
import { AddendumComparison } from "./AddendumComparison";
import { DemandDocuments, DemandPending } from "./DemandDocuments";
import { OfficialPanel } from "./OfficialPanel";
import { GlpiPage } from "./GlpiPage";
import { OfficialTemplates } from "./OfficialTemplates";
import { TemplateViewer } from "./TemplateViewer";
import {glpiStatusLabel,glpiPriorityLabel,demandPriorityRank,matchesDemandQueue,demandContractStage,demandStageLabel,isGlpiSolved,isOpenDemand,type DemandQueue} from "../shared/glpi-ticket-meta";
import { officialInputs } from "../shared/official-fields";
import { organizationAllowed } from "../shared/organization-policy";
import { Organizations } from "./Organizations";
import { GlpiIntake } from "./GlpiIntake";
const stages = [
  "Recebido",
  "Aguardando informações",
  "Em elaboração",
  "Em conferência",
  "Em aprovação",
  "Em assinatura",
  "Concluído",
  "Devolvido",
  "Cancelado",
];
const nextStages: Record<string, string[]> = {
  Recebido: ["Aguardando informações", "Em elaboração"],
  "Aguardando informações": ["Em elaboração"],
  "Em elaboração": ["Em conferência"],
  "Em conferência": ["Em elaboração", "Em aprovação"],
  "Em aprovação": ["Em elaboração", "Em assinatura"],
  "Em assinatura": ["Concluído"],
  Devolvido: ["Em elaboração"],
};
const transitions = (stage: string) =>
  ["Concluído", "Cancelado"].includes(stage)
    ? []
    : [...(nextStages[stage] || []), "Devolvido", "Cancelado"].filter(
        (s) => s !== stage,
      );
const labels: Record<string, string> = {
  cnpj: "CNPJ",
  razaoSocial: "Razão social",
  remuneracao: "Taxa de remuneração",
  garantia: "Percentual de garantia",
  repasse: "Percentual de repasse",
  cashback: "Cashback percentual (cadastro legado)",
  cashbackValor: "Valor do cashback (R$)",
  valor: "Valor de referência",
  banco: "Banco",
  agencia: "Agência",
  conta: "Conta",
  inicio: "Início da vigência",
  fim: "Fim da vigência",
  dataRepasse: "Data do repasse",
  modalidade: "Modalidade de garantia",
  matriz: "Contrato matriz",
  aditivo: "Número do aditivo",
  endereco: "Endereço da escola",
  dataAssinaturaMatriz: "Data de assinatura da matriz",
  dataFormalizacao: "Data de formalização",
  localidade: "Localidade de formalização",
  cnpjSolidario: "CNPJ solidário (quando aplicável)",
  titularConta: "Titular da conta",
  documentoTitular: "CPF/CNPJ do titular",
  pix: "Chave PIX (quando aplicável)",
  motivo: "Motivo e descrição da alteração",
  ...officialInputs,
  demandaDistrato: "Demanda do distrato vinculada (ID, ex.: KD-…)",
  demandaNovoContrato: "Demanda do novo contrato vinculada (ID)",
};
const migrationKeys = ["demandaDistrato", "demandaNovoContrato"];
/** Fields shown in the data form: addenda use the server list; other types hide unrelated fields. */
function formKeys(detail: any) {
  if (detail.visibleFields)
    return Object.keys(labels).filter((key) => detail.visibleFields.includes(key));
  return Object.keys(labels).filter(
    (key) =>
      (!migrationKeys.includes(key) || detail.type === "Migração de modalidade") &&
      (!(key in officialInputs) || (detail.officialFields || []).includes(key)),
  );
}
const placeholders: Record<string, string> = {
  cep: "Ex.: 60000-000",
  estado: "Ex.: Ceará",
  representanteCpf: "Ex.: 000.000.000-00",
  duracaoMeses: "Ex.: 12",
  diaRepasse: "Dia do mês, ex.: 10",
  diaSegundoRepasse: "Dia do mês, ex.: 20",
  parcelas: "Ex.: 2",
  alunos: "Ex.: 300",
};
const date = (s: string) =>
  s
    ? new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(new Date(s.length === 10 ? s + "T12:00:00Z" : s))
    : "—";
/** Hosted functions accept at most 4.5 MB per request: a larger file goes straight to private Storage and
 * the form carries its upload_id instead. When the server keeps files itself, it answers {direct:true}. */
async function sendLargeFiles(form: FormData) {
  for (const [field, value] of [...form.entries()]) {
    if (!(value instanceof File) || value.size <= 4 * 1024 * 1024) continue;
    const ticket = await fetch("/api/uploads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ size: value.size }) });
    const target = await ticket.json();
    if (!ticket.ok) throw Error(target.error || "Não foi possível preparar o envio do arquivo.");
    if (target.direct) continue;
    const sent = await fetch(target.url, { method: "PUT", body: value, headers: { "Content-Type": value.type || "application/octet-stream" } });
    if (!sent.ok) throw Error("Não foi possível enviar o arquivo. Tente novamente.");
    form.delete(field);
    form.set("upload_id", target.id);
    form.set("upload_name", value.name);
    form.set("upload_type", value.type || "application/octet-stream");
  }
}
async function api(path: string, body?: any, method?: string) {
  if (body instanceof FormData) await sendLargeFiles(body);
  const r = await fetch("/api" + path, {
    signal: ['/glpi/status','/glpi/tickets'].includes(path)||path.startsWith('/processing/progress?')?AbortSignal.timeout(20000):path==='/sync'?AbortSignal.timeout(615000):undefined,
    method: method || (body ? "POST" : "GET"),
    headers:
      body instanceof FormData ? {} : { "Content-Type": "application/json" },
    body:
      body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw Object.assign(Error(data.error), { fields: data.fields });
  return data;
}
const Badge = ({ stage }: { stage: string }) => (
  <span className={"badge " + (stage==="Sem erros"?"conference-clean":stage==="Aguardando correção"?"conference-correction":Object.hasOwn(contractStageActions,stage)||["Aguardando análise","Conferência parcial"].includes(stage)?"conference-analysis":"stage-" + stages.indexOf(stage))}>
    <i />
    {demandStageLabel(stage)}
  </span>
);
const nav = [
  ["Dashboard", LayoutDashboard],
  ["Demandas", Files],
  ["Chamados GLPI", Inbox],
  ["Organizações", Files],
  ["Contratos e aditivos", FileCheck2],
  ["Modelos", BookOpen],
  ["Relatórios", ChartNoAxesCombined],
  ["Configurações", Settings],
] as const;
export function App() {
  const [advanced,setAdvanced]=useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [newType, setNewType] = useState("Contrato de garantia");
  const [newSchool, setNewSchool] = useState("");
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const focusField = (key: string) => {
    const input = document.getElementById("data-" + key);
    input?.scrollIntoView({ behavior: "smooth", block: "center" });
    input?.focus({ preventScroll: true });
  };
  const [user, setUser] = useState<any>(null),
    [data, setData] = useState<any>(null),
    [page, setPage] = useState("Dashboard"),
    [detail, setDetail] = useState<any>(null),
    [modal, setModal] = useState(""),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    [showDemoNotice, setShowDemoNotice] = useState(false),
    [signup, setSignup] = useState<"" | "form" | "sent">(""),
    [listLimit, setListLimit] = useState(30),
    [query, setQuery] = useState(""),
    [stage, setStage] = useState(""),
    [owner, setOwner] = useState(""),
    [priority, setPriority] = useState(""),
    [demandQueue,setDemandQueue]=useState<DemandQueue>("all"),
    [dashboardQueue, setDashboardQueue] = useState<"all"|"open"|"pending">("all"),
    [showAllDashboardDemands, setShowAllDashboardDemands] = useState(false),
    [type, setType] = useState(""),
    [deadline, setDeadline] = useState(""),
    [mobile, setMobile] = useState(false);
  const can = (p: string) => user?.permissions.includes(p);
  async function load() {
    setData(await api("/bootstrap"));
  }
  useEffect(()=>{
    if(!user || !data?.demands?.some((d:any)=>d.processing?.status==="Analisando"))return;
    const timer=setInterval(()=>{api("/bootstrap").then(setData).catch(()=>{});},2500);
    return()=>clearInterval(timer);
  },[user?.id,!!data?.demands?.some((d:any)=>d.processing?.status==="Analisando")]);
  // A new search or filter starts again from the first rows.
  useEffect(() => setListLimit(30), [query, stage, page]);
  useEffect(() => {
    api("/login-info")
      .then((info) => setShowDemoNotice(info.showDemoNotice === true))
      .catch(() => {});
    api("/me")
      .then((u) => {
        setUser(u);
        return load();
      })
      .catch((e) => {
        if (e.message !== "Entre na sua conta para continuar.")
          setError(e.message);
      })
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    if (!modal) return;
    const prior = document.activeElement as HTMLElement;
    const dialog = document.querySelector(".modal");
    const controls = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          "button,input,select,textarea,a[href]",
        ) || [],
      ).filter((e) => !e.hasAttribute("disabled"));
    controls()[0]?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModal("");
      if (e.key === "Tab") {
        const list = controls(),
          first = list[0],
          last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      prior?.focus();
    };
  }, [modal]);
  async function action(
    fn: () => Promise<any>,
    message = "Alterações salvas.",
  ) {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await fn();
      await load();
      if (detail) setDetail(await api("/demands/" + detail.id));
      setSuccess(message);
    } catch (e: any) {
      setError(e.message);
      if (e.fields) {
        setFieldErrors(e.fields);
        requestAnimationFrame(() => focusField(Object.keys(e.fields)[0]));
      }
    } finally {
      setBusy(false);
    }
  }
  async function open(id: string) {
    setAdvanced(false);
    setFieldErrors({});
    setMissingFields([]);
    setBusy(true);
    try {
      setDetail(await api("/demands/" + id));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(
    e: React.FormEvent<HTMLFormElement>,
    fn: (b: any) => Promise<any>,
    message?: string,
  ) {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.currentTarget));
    await action(() => fn(b), message);
  }
  if (!ready)
    return <div className="loading">Carregando a central de contratos…</div>;
  if (!user)
    return (
      <div className="login">
        <ThemeToggle login />
        <div className="login-story">
          <div className="wordmark">
            kedu<span>›</span>
          </div>
          <h1>
            Mais clareza.
            <br />
            Menos retrabalho.
          </h1>
          <p>
            Da solicitação ao contrato assinado,
            <br />
            cada etapa no seu lugar.
          </p>
          <div className="login-seal">
            <ShieldCheck /> Central de gestão contratual
          </div>
        </div>
        {signup ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const b = Object.fromEntries(new FormData(e.currentTarget));
              if (b.password !== b.confirm) return setError("As senhas não conferem.");
              setBusy(true);
              try {
                await api("/signup", { name: b.name, email: b.email, password: b.password });
                setSignup("sent");
                setError("");
              } catch (e: any) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <span className="eyebrow">Bem-vindo à Kedu</span>
            <h2>Pedir acesso</h2>
            {signup === "sent" ? (
              <p role="status">Pedido enviado. Um administrador vai analisar e liberar o seu acesso; depois disso, entre com o e-mail e a senha que você cadastrou.</p>
            ) : (
              <>
                <p>A conta só funciona depois da aprovação de um administrador.</p>
                <label>Nome completo<input name="name" required minLength={3} maxLength={120} /></label>
                <label>E-mail<input name="email" type="email" required maxLength={200} /></label>
                <label>Senha (mínimo 12 caracteres)<input name="password" type="password" required minLength={12} maxLength={200} autoComplete="new-password" /></label>
                <label>Confirme a senha<input name="confirm" type="password" required minLength={12} maxLength={200} autoComplete="new-password" /></label>
                {error && <div className="alert error" role="alert">{error}</div>}
                <button className="primary" disabled={busy}>{busy ? "Enviando…" : "Enviar pedido"}<ArrowUpRight size={17} /></button>
              </>
            )}
            <button type="button" className="text-button login-signup" onClick={() => { setSignup(""); setError(""); }}>Voltar para o login</button>
          </form>
        ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const b = Object.fromEntries(new FormData(e.currentTarget));
            setBusy(true);
            try {
              setUser(await api("/login", b));
              await load();
              setError("");
            } catch (e: any) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <span className="eyebrow">Bem-vindo à Kedu</span>
          <h2>Acesse sua central</h2>
          <p>Use sua conta para acompanhar os contratos.</p>
          <label>
            E-mail
            <input
              name="email"
              type="email"
              required
            />
          </label>
          <label>
            Senha
            <input
              name="password"
              type="password"
              required
            />
          </label>
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "Entrando…" : "Entrar na central"}
            <ArrowUpRight size={17} />
          </button>
          <button type="button" className="text-button login-signup" onClick={() => { setSignup("form"); setError(""); }}>Não tem conta? Pedir acesso</button>
          {showDemoNotice && (
            <small>
              Ambiente demonstrativo • Dados fictícios
              <br />
              Contas e perfis disponíveis no README.
            </small>
          )}
        </form>
        )}
      </div>
    );
  if (!data)
    return (
      <div className="loading">
        <div>
          <p role="alert">
            {error ||
              "Não foi possível carregar os dados. Verifique se o servidor está ativo."}
          </p>
          <button
            className="primary"
            onClick={() => action(load, "Dados carregados.")}
            disabled={busy}
          >
            {busy ? "Carregando…" : "Tentar novamente"}
          </button>
        </div>
      </div>
    );
  const displayStage = (d: any) => demandContractStage(d);
  const listStages=[...new Set<string>(["Analisando","Aguardando análise","Conferência parcial","Aguardando correção","Sem erros",...data.demands.map(displayStage)])];
  const dashboardQueues = [
    ["all", "Todos"],
    ["open", "Em andamento no GLPI"],
    ["pending", "Pendentes no GLPI"],
  ] as const;
  const dashboardGroups = dashboardQueues.map(([key,label])=>({
    key,label,demands:data.demands.filter((d:any)=>matchesDemandQueue(d,key)),
  }));
  const dashboardGroup = dashboardGroups.find(group=>group.key===dashboardQueue)!;
  const stageCounts=new Map<string,number>();
  for(const demand of dashboardGroup.demands){
    const stage=displayStage(demand);
    stageCounts.set(stage,(stageCounts.get(stage)||0)+1);
  }
  const flowStages=listStages.filter(s=>stageCounts.has(s));
  const largestStage=Math.max(1,...stageCounts.values());
  const dashboardDemands=[...dashboardGroup.demands].sort((a:any,b:any)=>
    Number(matchesDemandQueue(b,"open"))-Number(matchesDemandQueue(a,"open"))
    || Number(isOpenDemand(b))-Number(isOpenDemand(a))
    || (a.due||"9999").localeCompare(b.due||"9999"),
  );
  function openDashboardDemands(selectedStage=""){
    setDemandQueue(dashboardQueue);
    setStage(selectedStage);
    setQuery("");
    setOwner("");
    setPriority("");
    setType("");
    setDeadline("");
    setPage("Demandas");
  }
  const filtered = data.demands.filter(
    (d: any) =>
      matchesDemandQueue(d,demandQueue) &&
      (!query ||
        [d.school, d.data.cnpj, d.glpi_id, d.id]
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase())) &&
      (!stage || displayStage(d) === stage) &&
      (!owner || d.owner === owner) &&
      (!priority || (d.glpiOrigin?glpiPriorityLabel(d.glpiOrigin.priority):d.priority) === priority) &&
      (!type || d.type === type) &&
      (!deadline ||
        (deadline === "overdue"
          ? !!d.due && d.due <
              new Intl.DateTimeFormat("en-CA", {
                timeZone: "America/Sao_Paulo",
              }).format(new Date()) &&
            !["Concluído", "Cancelado"].includes(d.stage)
          : d.due >=
            new Intl.DateTimeFormat("en-CA", {
              timeZone: "America/Sao_Paulo",
            }).format(new Date()))),
  );
  filtered.sort((a:any,b:any)=>demandPriorityRank(b)-demandPriorityRank(a));
  const table = (rows: any[], compact = false) => (
    <div className="table-scroll">
      <table className="demand-table">
        <thead>
          <tr>
            <th>Escola / demanda</th>
            <th>Documento</th>
            <th>Etapa</th>
            <th>Prioridade</th>
            <th>Responsável</th>
            <th>Prazo</th>
            <th aria-label="Abrir" />
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id} onClick={() => open(d.id)}>
              <td>
                <button
                  className="table-link"
                  onClick={(e) => {
                    e.stopPropagation();
                    open(d.id);
                  }}
                >
                  {d.school}
                </button>
                <small>
                  {d.id} <span>• GLPI #{d.glpi_id || "Manual"}</span>
                  {d.glpiOrigin && !isGlpiSolved(d.glpiOrigin.status) && <span> • {glpiStatusLabel(d.glpiOrigin.status)} no GLPI</span>}
                </small>
                {d.glpiOrigin && isGlpiSolved(d.glpiOrigin.status) && <span className="badge glpi-solved-badge" title="O chamado foi solucionado no GLPI; esta demanda ainda pode ter pendências de análise ou correção.">✓ Chamado solucionado no GLPI</span>}
              </td>
              <td>
                {d.type}
                {!!d.receivedDocumentTypes?.length && <small><strong>Recebido: {d.receivedDocumentTypes.join(', ')}</strong></small>}
                {d.documentCheck && !d.processing && <small className={d.documentCheck.stale ? "" : d.documentCheck.status === "divergente" ? "urgent" : d.documentCheck.status === "conforme" ? "positive" : ""}>{d.documentCheck.stale ? "Análise desatualizada" : d.documentCheck.status === "divergente" ? "Erro no anexo — corrigir" : d.documentCheck.status === "conforme" ? "Valores conferidos; revisão pendente" : "Anexo exige conferência manual"}</small>}
              </td>
              <td>
                <Badge stage={displayStage(d)} />
                {!compact && stage && Object.hasOwn(contractStageActions,stage) && d.processing?.contractReason &&
                  <small>{d.processing.contractReason}</small>}
              </td>
              <td><span className={"badge priority-badge priority-"+demandPriorityRank(d)}>{d.glpiOrigin?glpiPriorityLabel(d.glpiOrigin.priority):d.priority}</span></td>
              <td>
                <span className="avatar tiny">
                  {d.owner_name
                    .split(" ")
                    .map((s: string) => s[0])
                    .slice(0, 2)
                    .join("")}
                </span>
                <span>
                  {compact ? d.owner_name.split(" ")[0] : d.owner_name}
                </span>
              </td>
              <td
                className={
                  d.due && d.due <
                    new Intl.DateTimeFormat("en-CA", {
                      timeZone: "America/Sao_Paulo",
                    }).format(new Date()) &&
                  !["Concluído", "Cancelado"].includes(d.stage)
                    ? "urgent"
                    : ""
                }
              >
                {date(d.due)}
                <small>
                  {d.due && d.due <
                    new Intl.DateTimeFormat("en-CA", {
                      timeZone: "America/Sao_Paulo",
                    }).format(new Date()) &&
                  !["Concluído", "Cancelado"].includes(d.stage)
                    ? "Prazo vencido"
                    : ""}
                </small>
              </td>
              <td>
                <button className="open-demand" aria-label={`Abrir demanda ${d.id} e conferir documentos`} title="Abrir demanda e conferir documentos" onClick={e=>{e.stopPropagation();open(d.id);}}><ChevronRight size={17} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <div className="empty">
          <Inbox />
          <h3>Nenhuma demanda encontrada</h3>
          <p>Ajuste os filtros ou crie uma nova solicitação.</p>
        </div>
      )}
    </div>
  );
  return (
    <div className="shell">
      <aside className={mobile ? "sidebar expanded" : "sidebar"}>
        <div className="brand">
          <div className="wordmark">
            kedu<span>›</span>
          </div>
          <span>Contratos</span>
        </div>
        <div className="workspace">
          <span className="workspace-icon">
            <Files size={19} />
          </span>
          <div>
            Central de gestão<small>Operação contratual</small>
          </div>
        </div>
        <nav>
          {nav.map(([title, Icon]) => (
            <button
              key={title}
              className={page === title ? "active" : ""}
              onClick={() => {
                setPage(title);
                setDetail(null);
                setMobile(false);
                setQuery("");
              }}
            >
              <Icon size={19} />
              {title}
              {title === "Demandas" && (
                <span className="nav-count">{data.metrics.open}</span>
              )}
              {title === "Chamados GLPI" && data.metrics.glpiTriage > 0 && (
                <span className="nav-count">{data.metrics.glpiTriage}</span>
              )}
              {title === "Configurações" && can("settings") && data.users?.some((u: any) => u.pending) && (
                <span className="nav-count" title="Pedidos de acesso">{data.users.filter((u: any) => u.pending).length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="protected">
            <ShieldCheck size={19} />
            <div>
              Histórico protegido<small>Cada ação deixa um registro.</small>
            </div>
          </div>
          <div className="profile">
            <span className="avatar">
              {user.name
                .split(" ")
                .map((s: string) => s[0])
                .slice(0, 2)
                .join("")}
            </span>
            <div>
              {user.name}
              <small>{user.role}</small>
            </div>
            <button
              aria-label="Alterar senha"
              title="Alterar senha"
              onClick={() => setModal("senha")}
            >
              <KeyRound size={17} />
            </button>
            <button
              aria-label="Sair"
              onClick={() =>
                action(async () => {
                  await api("/logout", {});
                  setUser(null);
                }, "Sessão encerrada.")
              }
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button
            className="menu-button"
            aria-label="Abrir navegação"
            onClick={() => setMobile(!mobile)}
          >
            <PanelLeftClose size={20} />
          </button>
          <div>
            Central de contratos <ChevronRight size={14} />{" "}
            <strong>{detail ? "Detalhe da demanda" : page}</strong>
          </div>
          <ThemeToggle />
          {showDemoNotice && (
            <span className="environment">
              <i /> Ambiente de demonstração
            </span>
          )}
        </header>
        <main>
          <div className="demo-banner">
            <span>
              <span className="demo-dot" />{" "}
              {data.glpi?.mode === "real"
                ? "GLPI em modo real — somente leitura"
                : "Modo demonstração — GLPI com chamados fictícios"}
            </span>
            <button
              onClick={() => {
                setPage("Chamados GLPI");
                setDetail(null);
              }}
            >
              Ver integração <ArrowUpRight size={14} />
            </button>
          </div>
          {error && (
            <div className="alert error" role="alert">
              <TriangleAlert size={18} />
              {error}
              <button onClick={() => setError("")} aria-label="Fechar erro">
                ×
              </button>
            </div>
          )}
          {success && (
            <div className="alert success" role="status">
              <Check size={18} />
              {success}
              <button
                onClick={() => setSuccess("")}
                aria-label="Fechar mensagem"
              >
                ×
              </button>
            </div>
          )}
          {busy && (
            <div className="progress" role="status">
              Processando…
            </div>
          )}
          {detail && advanced && <button className="back" onClick={()=>setAdvanced(false)}>← Voltar para o contrato e as correções</button>}
          {detail ? (
            !advanced ? <SimpleDemand key={detail.id} detail={detail} data={data} can={can} api={api} action={action} busy={busy} onBack={()=>{setDetail(null);setPage("Demandas");}} onAdvanced={()=>setAdvanced(true)} onModels={()=>{setDetail(null);setPage("Modelos");}} /> :
            detail.glpiIntake && !detail.glpiIntake.confirmed_at ? <GlpiIntake detail={detail} data={data} can={can} api={api} action={action} busy={busy} back={() => { setDetail(null); setPage("Demandas"); }} registry={() => { setDetail(null); setPage("Organizações"); }} /> : <>
              <button className="back" onClick={() => setDetail(null)}>
                <ArrowLeft size={16} /> Voltar para {page.toLowerCase()}
              </button>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">
                    {detail.id} • GLPI #{detail.glpi_id || "Manual"}
                  </span>
                  <h1>
                    {
                      (data.organizations || data.schools).find((s: any) => s.id === detail.school_id)
                        ?.name
                    }
                  </h1>
                  <p>
                    {detail.type} • Dados v{detail.data_version} • Prazo{" "}
                    {date(detail.due)}
                  </p>
                </div>
                <Badge stage={detail.stage} />
              </div>
              <DemandDocuments key={detail.id} detail={detail} can={can} />
              <AttachmentCheck key={"attachment-"+detail.id} detail={detail} can={can} api={api} action={action} busy={busy} />
              <AddendumComparison
                detail={detail}
                labels={labels}
                can={can}
                busy={busy}
                action={action}
                api={api}
              />
              <div className="detail-grid">
                <section className="panel">
                  <div className="panel-heading">
                    <h2>
                      {detail.type === "Aditivo"
                        ? "Dados da escola e alteração proposta"
                        : "Dados e condições comerciais"}
                    </h2>
                    <span
                      className={"badge " + (detail.confirmed ? "ok" : "warn")}
                    >
                      {detail.confirmed
                        ? "Confirmados"
                        : "Confirmação pendente"}
                    </span>
                  </div>
                  <form
                    onChange={(event) => {
                      const form = event.currentTarget;
                      const values = Object.fromEntries(new FormData(form));
                      const target =
                        event.target as unknown as HTMLInputElement;
                      setFieldErrors((previous) => {
                        const next = { ...previous };
                        if (previous[target.name]) {
                          const issue = validateData(values)[target.name];
                          if (issue) next[target.name] = issue;
                          else delete next[target.name];
                        }
                        return next;
                      });
                      setMissingFields((previous) =>
                        previous.filter(
                          (key) => !String(values[key] ?? "").trim(),
                        ),
                      );
                    }}
                    onSubmit={(e) =>
                      submit(
                        e,
                        (b) => {
                          const issues = validateData(b);
                          setFieldErrors(issues);
                          if (Object.keys(issues).length) {
                            requestAnimationFrame(() =>
                              focusField(Object.keys(issues)[0]),
                            );
                            throw Error(
                              "Corrija os campos destacados antes de salvar.",
                            );
                          }
                          const output = {
                            ...b,
                            expected_version: detail.data_version,
                            checklist: b.checklist === "on",
                            ...(can("bank") &&
                            (!detail.visibleFields ||
                              detail.visibleFields.includes("banco"))
                              ? { contaTerceiro: b.contaTerceiro === "on" }
                              : {}),
                          };
                          return api(
                            "/demands/" + detail.id + "/data",
                            output,
                            "PUT",
                          );
                        },
                        "Dados atualizados. Aprovações anteriores invalidadas.",
                      )
                    }
                  >
                    <details className="form-instructions">
                      <summary>Como preencher os dados <span>Ver exemplos e orientações</span></summary>
                      <ul>
                        <li><strong>Campos com *:</strong> são necessários para confirmar. Você pode salvar um rascunho com campos vazios e completar depois.</li>
                        <li><strong>Percentuais:</strong> use vírgula, duas casas decimais e o símbolo %. Por exemplo: 3,3 → <strong>3,30%</strong>; 100 → <strong>100,00%</strong>; zero → <strong>0,00%</strong>. O valor deve ficar entre 0,00% e 100,00%.</li>
                        <li><strong>Valores em reais:</strong> informe os centavos com vírgula. Por exemplo: dez mil reais → <strong>10.000,00</strong>; zero → <strong>0,00</strong>. O campo “Valor do cashback (R$)” recebe dinheiro; campos de percentual recebem %.</li>
                        <li><strong>CNPJ e razão social:</strong> confira no documento da organização. Digite o CNPJ com pontuação, no formato <strong>00.000.000/0000-00</strong>, e a razão social completa.</li>
                        <li><strong>Banco, agência e conta:</strong> copie do comprovante bancário, preservando zeros à esquerda e o dígito da conta. Não substitua informações desconhecidas por zero.</li>
                        <li><strong>Datas:</strong> selecione no calendário ou preencha dia, mês e ano. O fim da vigência não pode ser anterior ao início. Se o pedido informar apenas um mês, confirme o dia antes de preencher.</li>
                        <li><strong>Contrato matriz e aditivo:</strong> os vínculos são preenchidos pelo sistema. Confira os documentos de origem; esses campos não são editáveis neste formulário.</li>
                        <li><strong>Para continuar:</strong> clique em “Salvar dados” para registrar o preenchimento e depois em “Confirmar dados críticos”. Se houver erro, leia a orientação abaixo do campo, corrija e salve novamente.</li>
                      </ul>
                      <p>Os exemplos explicam o formato. Preencha os valores reais que foram conferidos nos documentos e na solicitação.</p>
                    </details>
                    <div className="form-grid">
                      {formKeys(detail)
                        .map((key) => [key, labels[key]] as [string, string])
                        .filter(
                          ([key]) => can("bank") || !bankFields.includes(key),
                        )
                        .map(([key, label]) => (
                          <label
                            key={key}
                            className={
                              fieldErrors[key]
                                ? "data-field invalid-field"
                                : missingFields.includes(key)
                                  ? "data-field missing-field"
                                  : "data-field"
                            }
                          >
                            {label}
                            {(
                              detail.requiredFields || requiredDataFields
                            ).includes(key) && (
                              <span className="required-marker" title="Obrigatório para confirmar" aria-label="obrigatório">
                                *
                              </span>
                            )}
                            {key === "modalidade" ? (
                              <select
                                id={"data-" + key}
                                aria-invalid={!!fieldErrors[key]}
                                aria-describedby={
                                  fieldErrors[key] ||
                                  missingFields.includes(key)
                                    ? "issue-" + key
                                    : undefined
                                }
                                name={key}
                                key={detail.id + detail.data_version + key}
                                defaultValue={detail.data[key] || ""}
                                disabled={!can("write")}
                              >
                                <option value="">Selecione a modalidade</option>
                                <option>Garantia Completa</option>
                                <option>Garantia Conjunta</option>
                                <option>Garantia Prevista</option>
                              </select>
                            ) : key === "incorporaMatricula" ? (
                              <select
                                id={"data-" + key}
                                name={key}
                                key={detail.id + detail.data_version + key}
                                defaultValue={detail.data[key] || ""}
                                disabled={!can("write")}
                              >
                                <option value="">Selecione</option>
                                <option>Sim</option>
                                <option>Não</option>
                              </select>
                            ) : (
                              <input
                                id={"data-" + key}
                                aria-invalid={!!fieldErrors[key]}
                                aria-describedby={
                                  fieldErrors[key] ||
                                  missingFields.includes(key)
                                    ? "issue-" + key
                                    : undefined
                                }
                                name={key}
                                placeholder={
                                  [
                                    "remuneracao",
                                    "garantia",
                                    "repasse",
                                    "cashback",
                                    "repasseSegundo",
                                  ].includes(key)
                                    ? "Ex.: 3,30%"
                                    : ["valor", "cashbackValor"].includes(key)
                                      ? "Ex.: 10.000,00"
                                      : placeholders[key]
                                }
                                defaultValue={detail.data[key] || ""}
                                key={detail.id + detail.data_version + key}
                                type={
                                  [
                                    "inicio",
                                    "fim",
                                    "dataRepasse",
                                    "dataAssinaturaMatriz",
                                    "dataFormalizacao",
                                  ].includes(key)
                                    ? "date"
                                    : "text"
                                }
                                readOnly={
                                  !can("write") ||
                                  ["matriz", "aditivo"].includes(key)
                                }
                              />
                            )}
                            {(fieldErrors[key] ||
                              missingFields.includes(key)) && (
                              <span
                                id={"issue-" + key}
                                className="field-message"
                              >
                                {fieldErrors[key] ||
                                  "Preenchimento obrigatório."}
                              </span>
                            )}
                          </label>
                        ))}
                    </div>
                    {can("bank") &&
                      (!detail.visibleFields ||
                        detail.visibleFields.includes("banco")) && (
                        <label className="checkbox">
                          <input
                            type="checkbox"
                            name="contaTerceiro"
                            defaultChecked={detail.data.contaTerceiro === true}
                            key={"third-party" + detail.data_version}
                            disabled={!can("write")}
                          />
                          Conta de terceiro — exige procuração pública
                          específica e conferência de titularidade.
                        </label>
                      )}
                    <label className="checkbox">
                      <input
                        name="checklist"
                        type="checkbox"
                        defaultChecked={detail.data.checklist}
                        key={detail.data_version}
                        disabled={!can("write")}
                      />{" "}
                      Documentação obrigatória recebida e verificada por pessoa
                      responsável
                    </label>
                    {!can("bank") && (
                      <p className="muted">
                        Dados bancários restritos ao seu perfil.
                      </p>
                    )}
                    {(Object.keys(fieldErrors).length > 0 ||
                      missingFields.length > 0) && (
                      <div className="field-summary" role="status">
                        <strong>Revise os campos indicados</strong>
                        <p>
                          Campos vazios podem ser salvos como rascunho, mas
                          impedem a confirmação.
                        </p>
                        <ul>
                          {[
                            ...new Set([
                              ...Object.keys(fieldErrors),
                              ...missingFields,
                            ]),
                          ]
                            .filter(
                              (key) =>
                                can("bank") ||
                                !["banco", "agencia", "conta"].includes(key),
                            )
                            .map((key) => (
                              <li key={key}>
                                <button
                                  type="button"
                                  onClick={() => focusField(key)}
                                >
                                  {labels[key] || key}
                                </button>
                                : {fieldErrors[key] || "não preenchido"}
                              </li>
                            ))}
                        </ul>
                      </div>
                    )}
                    {can("write") && (
                      <button className="secondary" disabled={busy}>
                        {busy ? "Salvando…" : "Salvar dados"}
                      </button>
                    )}
                    {error && (
                      <p role="alert" className="inline-warning">
                        {error}
                      </p>
                    )}
                    {success && (
                      <p role="status" className="positive">
                        {success}
                      </p>
                    )}
                  </form>
                  {can("confirm") && (
                    <button
                      className="primary"
                      disabled={busy || detail.confirmed}
                      onClick={() => {
                        setMissingFields(
                          (detail.requiredFields || requiredDataFields).filter(
                            (key: string) => !String(detail.data[key] ?? "").trim(),
                          ),
                        );
                        action(
                          () => api("/demands/" + detail.id + "/confirm", {}),
                          "Dados críticos confirmados.",
                        );
                      }}
                    >
                      Confirmar dados críticos
                    </button>
                  )}
                  <DemandPending detail={detail} labels={labels} />
                </section>
                <div>
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>Próximas ações</h2>
                      <ShieldCheck size={18} />
                    </div>
                    <p className="muted">
                      As regras de cada etapa são validadas pelo servidor.
                    </p>
                    {can("write") && (
                      <form
                        onSubmit={(e) =>
                          submit(
                            e,
                            (b) => api("/demands/" + detail.id + "/stage", b),
                            "Etapa atualizada.",
                          )
                        }
                      >
                        <label>
                          Encaminhar para
                          <select name="stage" key={detail.id + detail.stage}>
                            {transitions(detail.stage).map((s) => (
                              <option key={s}>{s}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Justificativa (devolução ou cancelamento)
                          <input
                            name="reason"
                            placeholder="Descreva o motivo"
                          />
                        </label>
                        <button className="secondary" disabled={busy}>
                          Atualizar etapa
                        </button>
                      </form>
                    )}
                    {can("write") && can("bank") && (
                      <form
                        onSubmit={(e) =>
                          submit(
                            e,
                            (b) =>
                              api("/demands/" + detail.id + "/generate", b),
                            "Minuta DOCX gerada.",
                          )
                        }
                      >
                        <label>
                          Modelo aprovado
                          <select name="template_version">
                            {data.templates
                              .filter(
                                (t: any) =>
                                  t.status === "aprovado" &&
                                  t.document_type === detail.type &&
                                  (detail.type !== "Aditivo" ||
                                    t.subtype === detail.requirements?.subtype),
                              )
                              .map((t: any) => (
                                <option key={t.version_id} value={t.version_id}>
                                  {t.name} · v{t.version}
                                </option>
                              ))}
                          </select>
                        </label>
                        <button className="primary" disabled={busy}>
                          <FileText size={16} /> Gerar minuta DOCX
                        </button>
                      </form>
                    )}
                    {can("review") && (
                      <button
                        className="secondary full"
                        disabled={busy}
                        onClick={() =>
                          action(
                            () => api("/demands/" + detail.id + "/review", {}),
                            "Conferência registrada. Consulte o resultado abaixo.",
                          )
                        }
                      >
                        <ShieldCheck size={16} /> Conferir última versão
                      </button>
                    )}
                    <label>
                      Justificativa de atraso (se ultrapassou a quinta-feira)
                      <input
                        id="delayReason"
                        minLength={10}
                        placeholder="Registre o motivo e a providência adotada"
                      />
                    </label>
                    {(detail.requirements?.approvals || ["Risco", "Jurídica"])
                      .filter((k: string) =>
                        can(
                          (
                            {
                              Comercial: "commercial",
                              Jurídica: "legal",
                              Risco: "risk",
                              Financeiro: "finance",
                            } as Record<string, string>
                          )[k],
                        ),
                      )
                      .map((kind: string) => (
                        <button
                          className="secondary full"
                          key={kind}
                          disabled={busy || detail.stage !== "Em aprovação"}
                          onClick={() =>
                            action(
                              () =>
                                api("/demands/" + detail.id + "/approve", {
                                  kind,
                                  delayReason:
                                    document.querySelector<HTMLInputElement>(
                                      "#delayReason",
                                    )?.value,
                                }),
                              "Aprovação " +
                                kind.toLowerCase() +
                                " registrada.",
                            )
                          }
                        >
                          Registrar aprovação {kind.toLowerCase()}
                        </button>
                      ))}
                  </section>
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>Minutas e versões</h2>
                      <span className="counter">{detail.documents.length}</span>
                    </div>
                    {detail.documents.map((d: any) => (
                      <div className="document" key={d.id}>
                        <FileText size={24} />
                        <div>
                          <strong>Minuta v{d.version}</strong>
                          <small>
                            Dados v{d.data_version} • {date(d.created)}
                          </small>
                        </div>
                        {can("files") && can("bank") && (
                          <a
                            aria-label={"Baixar minuta v" + d.version}
                            href={"/api/documents/" + d.id + "/download"}
                          >
                            <Download size={17} />
                          </a>
                        )}
                        {!!d.is_signed && (
                          <a
                            href={
                              "/api/documents/" + d.id + "/download?signed=1"
                            }
                          >
                            Assinado
                          </a>
                        )}
                      </div>
                    ))}
                    {!detail.documents.length && (
                      <p className="muted">
                        Nenhuma minuta. Confirme os dados para gerar o primeiro
                        DOCX.
                      </p>
                    )}
                    {can("files") && can("write") && (
                      <>
                        <label>
                          Enviar nova versão para conferência
                          <input
                            type="file"
                            accept=".docx"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) {
                                const b = new FormData();
                                b.append("file", f);
                                b.append(
                                  "attested",
                                  String(
                                    document.querySelector<HTMLInputElement>(
                                      "#signatureAttestation",
                                    )?.checked || false,
                                  ),
                                );
                                b.append(
                                  "template_version",
                                  document.querySelector<HTMLSelectElement>(
                                    "select[name=template_version]",
                                  )?.value || "",
                                );
                                action(
                                  () =>
                                    api("/demands/" + detail.id + "/upload", b),
                                  "Nova versão enviada.",
                                );
                              }
                              e.target.value = "";
                            }}
                          />
                        </label>
                        <label className="checkbox">
                          <input id="signatureAttestation" type="checkbox" />{" "}
                          Conferi que o arquivo final corresponde à minuta
                          aprovada e contém as assinaturas exigidas.
                        </label>
                        <label>
                          Registrar documento assinado (DOCX ou PDF)
                          <input
                            type="file"
                            disabled={detail.stage !== "Em assinatura"}
                            accept=".docx,.pdf"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) {
                                const b = new FormData();
                                b.append("file", f);
                                b.append(
                                  "attested",
                                  String(
                                    document.querySelector<HTMLInputElement>(
                                      "#signatureAttestation",
                                    )?.checked || false,
                                  ),
                                );
                                b.append(
                                  "template_version",
                                  document.querySelector<HTMLSelectElement>(
                                    "select[name=template_version]",
                                  )?.value || "",
                                );
                                action(
                                  () =>
                                    api(
                                      "/demands/" + detail.id + "/signature",
                                      b,
                                    ),
                                  "Documento assinado registrado manualmente.",
                                );
                              }
                              e.target.value = "";
                            }}
                          />
                        </label>
                        <small className="muted">
                          Registro manual. A aplicação não valida autenticidade
                          de assinatura. PDF assinado é armazenado sem conferir
                          seu conteúdo automaticamente.
                        </small>
                      </>
                    )}
                  </section>
                </div>
              </div>
              <OfficialPanel
                detail={detail}
                labels={labels}
                can={can}
                action={action}
                api={api}
                busy={busy}
              />
              <GovernancePanel
                detail={detail}
                can={can}
                action={action}
                api={api}
                busy={busy}
              />
              <section className="panel">
                <div className="panel-heading">
                  <h2>Resultado da conferência</h2>
                  <span className="muted">
                    Vinculado à versão exata do documento
                  </span>
                </div>
                {detail.reviews.length ? (
                  detail.reviews.map((r: any) => (
                    <div key={r.id} className="review">
                      <strong
                        className={
                          r.status === "conforme" ? "positive" : "urgent"
                        }
                      >
                        {r.status === "conforme"
                          ? "Conforme"
                          : r.status === "divergente"
                            ? "Divergências encontradas"
                            : "Inconclusiva"}{" "}
                        • {date(r.created)}
                      </strong>
                      {r.results.map((v: any, i: number) => (
                        <div className="finding" key={i}>
                          <strong>
                            {labels[v.field] || v.field} • {v.severity}
                          </strong>
                          <p>
                            Esperado: {v.expected}
                            <br />
                            Encontrado: {v.found}
                          </p>
                          <small>
                            {v.location} — {v.guidance}
                          </small>
                        </div>
                      ))}
                    </div>
                  ))
                ) : (
                  <p className="empty-text">
                    Gere uma minuta e execute a conferência.
                  </p>
                )}
              </section>
              <div className="two-columns">
                <section className="panel">
                  <h2>Aprovações</h2>
                  {detail.approvals.map((a: any) => (
                    <div className="timeline" key={a.id}>
                      <Check size={16} />
                      <div>
                        <strong>
                          {a.kind} • {a.valid ? "Válida" : "Invalidada"}
                        </strong>
                        <small>
                          {a.name} • Dados v{a.data_version} • {date(a.created)}
                        </small>
                      </div>
                    </div>
                  ))}
                  {!detail.approvals.length && (
                    <p className="muted">Nenhuma aprovação registrada.</p>
                  )}
                </section>
                <section className="panel">
                  <h2>Histórico de ações</h2>
                  {detail.history.map((a: any) => (
                    <div className="timeline" key={a.id}>
                      <span className="timeline-dot" />
                      <div>
                        {a.action}
                        <small>
                          {a.name} • {date(a.created)}
                        </small>
                      </div>
                    </div>
                  ))}
                </section>
              </div>
            </>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <h1>{page === "Dashboard" ? "Visão geral" : page}</h1>
                  <p>
                    {
                      (
                        {
                          Dashboard:
                            "Sua operação contratual, de ponta a ponta.",
                          Demandas:
                            "Organize solicitações e acompanhe cada etapa.",
                          Organizações:
                            "Escolas, fornecedores e outros cadastros em um só lugar.",
                          "Contratos e aditivos":
                            "Vínculos, vigência e histórico em um só lugar.",
                          Modelos:
                            "Documentos padronizados, versões controladas.",
                          Relatórios: "Dados para acompanhar sua operação.",
                          Configurações:
                            "Pessoas, políticas e integrações da central.",
                        } as any
                      )[page]
                    }
                  </p>
                </div>
                <div className="heading-actions">
                  {page === "Dashboard" && (
                    <span className="date-label">
                      <Clock size={15} />
                      {date(new Date().toISOString())}
                    </span>
                  )}
                  {["Dashboard", "Demandas"].includes(page) && can("write") && (
                    <button
                      className="primary"
                      onClick={() => setModal("demanda")}
                    >
                      <Plus size={17} /> Nova demanda
                    </button>
                  )}
                  {page === "Organizações" && can("schools") && (
                    <button
                      className="primary"
                      onClick={() => setModal("escola")}
                    >
                      <Plus size={17} /> Cadastrar escola
                    </button>
                  )}
                </div>
              </div>
              {page === "Dashboard" && (
                <>
                  <div className="metric-grid">
                    {[
                      [
                        "Demandas abertas",
                        data.metrics.open,
                        Files,
                        "Demandas ainda ativas",
                        "blue",
                      ],
                      [
                        "Prazos vencidos",
                        data.metrics.overdue,
                        TriangleAlert,
                        "Precisam de atenção",
                        "red",
                      ],
                      [
                        "Sem erros",
                        data.demands.filter((d:any)=>displayStage(d)==="Sem erros").length,
                        ShieldCheck,
                        "Dados comparados conferem",
                        "conference-clean",
                      ],
                      [
                        "Aguardando correção",
                        data.demands.filter((d:any)=>displayStage(d)==="Aguardando correção").length,
                        FileCheck2,
                        "Confira os itens indicados",
                        "conference-correction",
                      ],
                    ].map(([title, value, Icon, caption, color]: any) => (
                      <button
                        className={"metric " + color}
                        key={title}
                        onClick={() => {
                          setPage("Demandas");
                          setDemandQueue(title === "Demandas abertas" || title === "Prazos vencidos" ? "active" : "all");
                          setQuery("");
                          setOwner("");
                          setPriority("");
                          setType("");
                          setDeadline(
                            title === "Prazos vencidos" ? "overdue" : "",
                          );
                          setStage(
                            title === "Sem erros"
                              ? "Sem erros"
                              : title === "Aguardando correção"
                                ? "Aguardando correção"
                                : "",
                          );
                        }}
                      >
                        <div>
                          {title}
                          <span className="metric-icon">
                            <Icon size={19} />
                          </span>
                        </div>
                        <strong>{value.toString().padStart(2, "0")}</strong>
                        <small>
                          {caption}
                          <ArrowUpRight size={14} />
                        </small>
                      </button>
                    ))}
                  </div>
                  <div className="dashboard-middle">
                    <section className="panel flow-panel">
                      <div className="panel-heading">
                        <div>
                          <h2>O fluxo da operação</h2>
                          <p>Situação dos contratos e dos chamados no GLPI</p>
                        </div>
                        <span className="counter">
                          {dashboardGroup.demands.length} demandas
                        </span>
                      </div>
                      <div className="dashboard-glpi-queues" role="group" aria-label="Selecionar chamados para o gráfico e a lista">
                        {dashboardGroups.map(({key,label,demands})=>(
                          <button type="button" key={key} className={dashboardQueue===key?"primary":"secondary"}
                            aria-pressed={dashboardQueue===key} onClick={()=>{
                              setDashboardQueue(key);
                              setShowAllDashboardDemands(false);
                            }}>
                            {label} <span className="queue-count">{demands.length}</span>
                          </button>
                        ))}
                      </div>
                      {flowStages.length ? <div className="flow-bars" aria-label={"Etapas · "+dashboardGroup.label}>
                        {flowStages.map(s => {
                          const n = stageCounts.get(s)||0;
                          return (
                            <button
                              key={s}
                              type="button"
                              aria-label={`Ver demandas em ${demandStageLabel(s)} (${n})`}
                              onClick={() => openDashboardDemands(s)}
                            >
                              <div className="bar-space">
                                <div
                                  className={"bar bar-" + listStages.indexOf(s)}
                                  style={{
                                    background:s==="Sem erros"?"#58a879":s==="Aguardando correção"?"#d86b62":s==="Consulta ao GLPI incompleta"?"#8db9ce":s==="Aguardando elaboração do contrato"?"#a99bd3":s==="Contrato não lido"?"#cd8848":["Aguardando análise","Contrato não encontrado"].includes(s)?"#d5ab44":s==="Conferência parcial"?"#e2c675":undefined,
                                    height:Math.max(8,(n/largestStage)*72)+"%",
                                  }}
                                >
                                  <span>{n}</span>
                                </div>
                              </div>
                              <small>
                                {s==="Consulta ao GLPI incompleta"?"Consulta incompleta":s==="Aguardando elaboração do contrato"?"Aguardando elaboração":demandStageLabel(s)}
                              </small>
                            </button>
                          );
                        })}
                      </div> : <p className="muted" role="status">Nenhuma demanda neste grupo.</p>}
                    </section>
                    <section className="summary-panel">
                      <span className="summary-symbol">
                        <Check size={23} />
                      </span>
                      <h2>
                        Cada contrato concluído,
                        <br />
                        um passo em frente.
                      </h2>
                      <div className="summary-numbers">
                        <div>
                          <strong>
                            {data.metrics.completed.toString().padStart(2, "0")}
                          </strong>
                          <small>concluídos neste mês</small>
                        </div>
                        <div>
                          <strong>
                            {data.metrics.average}
                            <span> dias</span>
                          </strong>
                          <small>tempo médio de atendimento</small>
                        </div>
                      </div>
                      <button onClick={() => setPage("Relatórios")}>
                        Acompanhar resultados <ArrowUpRight size={16} />
                      </button>
                    </section>
                  </div>
                  <section className="panel demand-panel">
                    <div className="panel-heading">
                      <div>
                        <h2>{dashboardQueue==="all"?"Todas as demandas":dashboardGroup.label}</h2>
                        <p>{dashboardDemands.length} demandas no grupo selecionado no gráfico.</p>
                      </div>
                      <button className="text-button" type="button" onClick={() => openDashboardDemands()}>
                        Abrir lista de demandas <ChevronRight size={16} />
                      </button>
                    </div>
                    {dashboardDemands.length ? table(
                      showAllDashboardDemands ? dashboardDemands : dashboardDemands.slice(0,5),
                      true,
                    ) : <p className="muted">Nenhuma demanda para exibir neste grupo.</p>}
                    {dashboardDemands.length>5&&<button className="text-button dashboard-list-more" type="button"
                      aria-expanded={showAllDashboardDemands} onClick={()=>setShowAllDashboardDemands(value=>!value)}>
                      {showAllDashboardDemands?"Mostrar só as 5 primeiras":`Mostrar todas as ${dashboardDemands.length} demandas`}
                    </button>}
                  </section>
                  {showDemoNotice && (
                    <div className="dashboard-note">
                      <ShieldCheck size={15} /> Dados fictícios para demonstração.
                      Modelos sem aprovação jurídica.
                    </div>
                  )}
                </>
              )}
              {page === "Demandas" && (
                <>
                  <section className="panel filters">
                    <div className="glpi-queue-tabs" role="group" aria-label="Separar demandas pelo status do GLPI">
                      {([ ["all","Todas"],["active","Abertas"],["open","Em andamento no GLPI"],["pending","Pendentes no GLPI"],["solved","Solucionados"],["closed","Fechados"] ] as const).map(([key,label])=><button key={key} type="button" className={demandQueue===key?"primary":"secondary"} aria-pressed={demandQueue===key} onClick={()=>setDemandQueue(key)}>{label} ({data.demands.filter((d:any)=>matchesDemandQueue(d,key)).length})</button>)}
                    </div>
                    <div className="filter-top">
                      <div className="search">
                        <Search size={18} />
                        <input
                          placeholder="Buscar por escola, CNPJ ou número GLPI"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                      </div>
                      <select
                        aria-label="Filtrar etapa"
                        value={stage}
                        onChange={(e) => setStage(e.target.value)}
                      >
                        <option value="">Todas as etapas</option>
                        {listStages.map((s) => (
                          <option key={s} value={s}>{demandStageLabel(s)}</option>
                        ))}
                      </select>
                    </div>
                    {stage && Object.hasOwn(contractStageActions,stage) && <p className="muted">{contractStageActions[stage]}</p>}
                    <details className="more-filters" open={!!(owner||priority||type||deadline)}>
                    <summary>Mais filtros</summary>
                    <div className="filter-row">
                      <select
                        aria-label="Filtrar responsável"
                        value={owner}
                        onChange={(e) => setOwner(e.target.value)}
                      >
                        <option value="">Todos os responsáveis</option>
                        {data.users.map((u: any) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="Filtrar prioridade"
                        value={priority}
                        onChange={(e) => setPriority(e.target.value)}
                      >
                        <option value="">Todas as prioridades</option>
                        {[...new Set<string>(data.demands.map((d:any)=>d.glpiOrigin?glpiPriorityLabel(d.glpiOrigin.priority):d.priority))].map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                      <select
                        aria-label="Filtrar tipo"
                        value={type}
                        onChange={(e) => setType(e.target.value)}
                      >
                        <option value="">Todos os tipos</option>
                        {[
                          "Contrato de garantia",
                          "Aditivo",
                          "Distrato",
                          "Migração de modalidade",
                          "CNPJ solidário",
                          "Antecipação K-invest",
                          "Parcelamento",
                          "Descredenciamento",
                          "Renovação com pendências",
                          "Alteração societária",
                          "Contrato educacional",
                          "Contrato fornecedor",
                          "Contrato marketing",
                        ].map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                      <select
                        aria-label="Filtrar prazo"
                        value={deadline}
                        onChange={(e) => setDeadline(e.target.value)}
                      >
                        <option value="">Todos os prazos</option>
                        <option value="overdue">Vencidos</option>
                        <option value="current">No prazo</option>
                      </select>
                      <button
                        className="text-button"
                        onClick={() => {
                          setStage("");
                          setOwner("");
                          setType("");
                          setPriority("");
                          setDeadline("");
                          setQuery("");
                          setDemandQueue("all");
                        }}
                      >
                        Limpar
                      </button>
                    </div>
                    </details>
                  </section>
                  <details className="panel fold"><summary><strong>Andamento da leitura dos arquivos</strong><small>Fila, leituras concluídas e falhas</small></summary><ProcessingProgress demands={filtered} api={api} allowed={!!can('files')&&!!can('bank')}/></details>
                  {(Object.hasOwn(contractStageActions,stage)||['Aguardando análise','Conferência parcial','Aguardando correção'].includes(stage))&&can('files')&&can('bank')&&<ProcessingSummary stage={Object.hasOwn(contractStageActions,stage)?'Aguardando análise':stage} demands={filtered} api={api}/>}
                  <section className="panel">{table(filtered.slice(0, listLimit))}
                    {filtered.length > listLimit && <button type="button" className="secondary list-more" onClick={() => setListLimit(listLimit + 30)}>Mostrar mais {Math.min(30, filtered.length - listLimit)} de {filtered.length - listLimit} restantes</button>}
                  </section>
                  <p className="muted">
                    {filtered.length} demandas encontradas. Etapas são alteradas
                    no detalhe com validação de pendências.
                  </p>
                </>
              )}
              {page === "Organizações" && <Organizations data={data} can={can} action={action} api={api} busy={busy} onEdit={(o:any)=>setModal("editar:"+o.id)} onDemands={(o:any)=>{setQuery(o.name);setStage("");setOwner("");setPriority("");setType("");setDeadline("");setPage("Demandas");}} />}
              {page === "Contratos e aditivos" && (
                <>
                  <SignedHistoryPanel
                    contracts={data.contracts}
                    can={can}
                    action={action}
                    api={api}
                    busy={busy}
                  />
                  <section className="panel">
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Contrato / escola</th>
                            <th>Vínculo</th>
                            <th>Vigência</th>
                            <th>Assinatura</th>
                            <th>Demandas</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.contracts.map((c: any) => (
                            <tr key={c.id}>
                              <td>
                                <strong>{c.school}</strong>
                                <small>{c.id}</small>
                              </td>
                              <td>
                                {c.parent_id
                                  ? "Aditivo " +
                                    c.sequence +
                                    " • Matriz " +
                                    c.parent_id
                                  : c.operation_type || "Contrato matriz"}
                              </td>
                              <td>
                                {date(c.start)} — {date(c.end)}
                              </td>
                              <td>
                                <span
                                  className={
                                    "badge " +
                                    (c.status === "Assinado" ? "ok" : "warn")
                                  }
                                >
                                  {c.status}
                                </span>
                              </td>
                              <td>
                                {data.demands
                                  .filter((d: any) => d.contract_id === c.id)
                                  .map((d: any) => (
                                    <button
                                      className="text-button"
                                      key={d.id}
                                      onClick={() => open(d.id)}
                                    >
                                      {d.id} <ChevronRight size={14} />
                                    </button>
                                  ))}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </>
              )}
              {page === "Modelos" && (
                <>
                  <OfficialTemplates
                    data={data}
                    can={can}
                    action={action}
                    api={api}
                    busy={busy}
                  />
                  <div className="alert info">
                    <BookOpen size={19} /> Modelos “DEMONSTRAÇÃO” não têm
                    aprovação jurídica e são bloqueados em produção.
                  </div>
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>Biblioteca de modelos DOCX</h2>
                      {can("settings") && (
                        <button
                          className="primary"
                          onClick={() => setModal("modelo")}
                        >
                          <Plus size={16} /> Novo modelo / versão
                        </button>
                      )}
                    </div>
                    {data.templates.map((t: any) => (
                      <div className="template-row" key={t.version_id}>
                        <span className="file-icon">
                          <FileText />
                        </span>
                        <div>
                          <strong>{t.name}</strong>
                          <small>
                            {t.type} • Versão {t.version} • {t.status}
                          </small>
                        </div>
                        <span
                          className={
                            "badge " + (t.status === "aprovado" ? "ok" : "warn")
                          }
                        >
                          {t.status}
                        </span>
                        {can("legal") && t.status === "rascunho" && !t.official && (
                          <button
                            className="secondary"
                            onClick={() =>
                              action(
                                () =>
                                  api(
                                    "/templates/" + t.version_id + "/approve",
                                    {},
                                  ),
                                "Versão aprovada e bloqueada para edição.",
                              )
                            }
                          >
                            Aprovar versão
                          </button>
                        )}
                        {can("settings") && t.status !== "inativo" && (
                          <button
                            className="text-button"
                            onClick={() =>
                              action(
                                () =>
                                  api(
                                    "/templates/" +
                                      t.version_id +
                                      "/deactivate",
                                    {},
                                  ),
                                "Modelo inativado. Versões históricas preservadas.",
                              )
                            }
                          >
                            Inativar
                          </button>
                        )}
                        {can("files") && <TemplateViewer id={t.version_id} api={api}/>}
                      </div>
                    ))}
                    <h3>Campos variáveis permitidos</h3>
                    <div className="variable-list">
                      {Object.keys(labels).map((f) => (
                        <code key={f}>{"{" + f + "}"}</code>
                      ))}
                    </div>
                    <p className="muted">
                      Versões aprovadas são imutáveis. Uma alteração exige
                      upload como nova versão. Preserve um parágrafo por campo
                      no formato “campo: {"{campo}"}” para conferência
                      estrutural nesta versão.
                    </p>
                  </section>
                </>
              )}
              {page === "Chamados GLPI" && (
                <GlpiPage
                  data={data}
                  can={can}
                  action={action}
                  api={api}
                  busy={busy}
                  open={open}
                />
              )}
              {page === "Relatórios" && (
                <Reports
                  users={data.users}
                  canExport={can("export")}
                  open={open}
                />
              )}
              {page === "Configurações" && (
                <>
                  <div className="two-columns">
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>Integração GLPI</h2>
                        <span className="badge warn">
                          {data.glpi?.mode === "real" ? "Modo real" : "Demonstração"}
                        </span>
                      </div>
                      <div className="integration-brand">
                        <span className="file-icon">
                          <Link2 />
                        </span>
                        <div>
                          <strong>GLPI → Kedu Contratos</strong>
                          <small>Importação somente de leitura</small>
                        </div>
                      </div>
                      <p className="muted">
                        Leitura dos grupos autorizados por app_token e
                        user_token configurados somente no servidor (.env).
                        Nenhuma escrita é feita no GLPI.
                      </p>
                      <button
                        className="primary"
                        onClick={() => setPage("Chamados GLPI")}
                      >
                        <RefreshCw size={16} /> Abrir chamados e sincronização
                      </button>
                    </section>
                    <section className="panel">
                      <h2>Mapeamento de campos e políticas</h2>
                      {data.settings.map((s: any) => (
                        <form
                          key={s.key}
                          onSubmit={(e) =>
                            submit(e, (b) =>
                              api("/settings", { key: s.key, value: b.value }),
                            )
                          }
                        >
                          <label>
                            {s.key === "glpiMapping"
                              ? "Mapeamento GLPI (demonstrativo)"
                              : "Encaminhamento jurídico obrigatório"}
                            <textarea
                              name="value"
                              defaultValue={s.value}
                              readOnly={!can("settings")}
                              rows={3}
                            />
                          </label>
                          {can("settings") && (
                            <button className="secondary">
                              Salvar configuração
                            </button>
                          )}
                        </form>
                      ))}
                    </section>
                  </div>
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>Usuários e perfis</h2>
                      {can("settings") && (
                        <button
                          className="secondary"
                          onClick={() => setModal("usuario")}
                        >
                          <Plus size={16} /> Cadastrar usuário
                        </button>
                      )}
                    </div>
                    {can("settings") && <AccessRequests users={data.users} api={api} action={action} busy={busy} />}
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Usuário</th>
                            <th>E-mail</th>
                            <th>Perfil</th>
                            <th>Acesso</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.users.filter((u: any) => !u.pending).map((u: any) => (
                            <tr key={u.id}>
                              <td>{u.name}</td>
                              <td>{u.email}</td>
                              <td>
                                {can("settings") && u.id !== user.id ? (
                                  <select
                                    aria-label={"Perfil de " + u.name}
                                    value={u.role}
                                    onChange={(e) =>
                                      action(
                                        () =>
                                          api(
                                            "/users/" + u.id + "/role",
                                            { role: e.target.value },
                                            "PUT",
                                          ),
                                        "Perfil atualizado. Sessões do usuário revogadas.",
                                      )
                                    }
                                  >
                                    <option>Administrador</option>
                                    <option>Solicitante</option>
                                    <option>Operação</option>
                                    <option>Jurídico</option>
                                    <option>Aprovador</option>
                                    <option>Consulta</option>
                                    <option>Risco</option>
                                    <option>Financeiro</option>
                                  </select>
                                ) : (
                                  <span className="badge">{u.role}</span>
                                )}
                              </td>
                              <td>
                                <span className={u.active === 0 ? "badge warn" : "badge"}>
                                  {u.active === 0 ? "Desativado" : "Ativo"}
                                </span>
                                {can("settings") && u.id !== user.id && (
                                  <>
                                    {" "}
                                    <button className="text-button" type="button" onClick={() => setModal("senha:" + u.id)}>
                                      Redefinir senha
                                    </button>{" "}
                                    <button
                                      className="text-button"
                                      type="button"
                                      onClick={() =>
                                        action(
                                          () => api("/users/" + u.id + "/access", { active: u.active === 0 }, "PUT"),
                                          u.active === 0 ? "Acesso reativado." : "Acesso desativado. As sessões abertas foram encerradas.",
                                        )
                                      }
                                    >
                                      {u.active === 0 ? "Reativar" : "Desativar"}
                                    </button>
                                  </>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                  <section className="panel">
                    <h2>Histórico de sincronização</h2>
                    {data.sync.length ? (
                      data.sync.map((s: any) => (
                        <div className="timeline" key={s.id}>
                          <RefreshCw size={16} />
                          <div>
                            <strong>
                              {s.status} • {s.imported} importadas
                            </strong>
                            <small>
                              {date(s.created)} • {s.message}
                            </small>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="empty-text">
                        {showDemoNotice
                          ? "Nenhuma sincronização executada. Inicie uma importação demonstrativa."
                          : "Nenhuma sincronização executada ainda."}
                      </p>
                    )}
                  </section>
                </>
              )}
            </>
          )}
          <footer>
            Kedu · Central de contratos{" "}
            <span>Controle em cada etapa. Confiança em cada dado.</span>
          </footer>
        </main>
      </div>
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal("")}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Cadastro"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-heading">
              <h2>
                {modal === "demanda"
                  ? "Nova demanda"
                  : modal === "escola"
                    ? "Cadastrar escola"
                    : modal.startsWith("editar:")
                      ? "Editar organização"
                      : modal === "modelo"
                        ? "Cadastrar modelo DOCX"
                        : modal === "senha"
                          ? "Alterar minha senha"
                          : modal.startsWith("senha:")
                            ? "Redefinir senha de " + (data.users.find((u: any) => "senha:" + u.id === modal)?.name || "usuário")
                            : "Cadastrar usuário"}
              </h2>
              <button
                className="close"
                aria-label="Fechar"
                onClick={() => setModal("")}
              >
                ×
              </button>
            </div>
            {modal === "demanda" ? (
              <form
                onSubmit={(e) =>
                  submit(
                    e,
                    async (b) => {
                      const result = await api("/demands", b);
                      setModal("");
                      await open(result.id);
                    },
                    "Demanda criada. Complete e confirme os dados.",
                  )
                }
              >
                <label>
                  Escola
                  <select
                    name="school_id"
                    required
                    value={newSchool}
                    onChange={(e) => setNewSchool(e.target.value)}
                  >
                    <option value="">Selecione a escola</option>
                    {(data.organizations || data.schools).filter((s: any) => organizationAllowed(newType, s.organization_kind || "Escola")).map((s: any) => (
                      <option key={s.id} value={s.id}>
                        {s.name} — {s.cnpj}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="form-grid">
                  <label>
                    Tipo de documento
                    <select
                      name="type"
                      value={newType}
                      onChange={(e) => { setNewType(e.target.value); setNewSchool(""); }}
                    >
                      {[
                        "Contrato de garantia",
                        "Aditivo",
                        "Distrato",
                        "Migração de modalidade",
                        "CNPJ solidário",
                        "Antecipação K-invest",
                        "Parcelamento",
                        "Descredenciamento",
                        "Renovação com pendências",
                        "Alteração societária",
                        "Contrato educacional",
                        "Contrato fornecedor",
                        "Contrato marketing",
                      ].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Prioridade
                    <select name="priority">
                      <option>Normal</option>
                      <option>Alta</option>
                      <option>Urgente</option>
                    </select>
                  </label>
                  <label>
                    Responsável
                    <select name="owner">
                      {data.users.map((u: any) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Prazo
                    <input name="due" type="date" required />
                  </label>
                </div>
                {newType === "Aditivo" && (
                  <label>
                    Tipo de aditivo
                    <select name="subtype" required defaultValue="">
                      <option value="">Selecione a alteração</option>
                      {[
                        "Conta bancária",
                        "Vigência",
                        "Percentual/data de repasse",
                        "Cashback",
                        "Taxa de remuneração",
                      ].map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  Contrato matriz (obrigatório para aditivo e operação jurídica
                  sobre contrato existente)
                  <select
                    name="matrix"
                    key={newSchool + newType}
                    defaultValue=""
                    required={[
                      "Aditivo",
                      "Distrato",
                      "Migração de modalidade",
                      "CNPJ solidário",
                      "Antecipação K-invest",
                      "Parcelamento",
                      "Descredenciamento",
                      "Renovação com pendências",
                      "Alteração societária",
                    ].includes(newType)}
                  >
                    <option value="">Selecione</option>
                    {data.contracts
                      .filter(
                        (c: any) =>
                          (c.status === "Assinado" || (newType === "Migração de modalidade" && c.status === "Distratado")) &&
                          c.instrument_kind === "Matriz" &&
                          c.school_id === newSchool,
                      )
                      .map((c: any) => (
                        <option key={c.id} value={c.id}>
                          {c.school} • {c.id}
                        </option>
                      ))}
                  </select>
                </label>
                <button className="primary" disabled={busy}>
                  Criar demanda
                </button>
              </form>
            ) : modal === "escola" || modal.startsWith("editar:") ? (
              <>
                <form
                  onSubmit={(e) =>
                    submit(e, async (b) => {
                      await api(
                        "/schools" +
                          (modal.startsWith("editar:")
                            ? "/" + modal.split(":")[1]
                            : ""),
                        b,
                        modal.startsWith("editar:") ? "PUT" : "POST",
                      );
                      setModal("");
                    })
                  }
                >
                  {["name", "legal_name", "cnpj", "address", "contact"].map(
                    (f, i) => (
                      <label key={f}>
                        {
                          [
                            "Nome fantasia",
                            "Razão social",
                            "CNPJ (00.000.000/0000-00)",
                            "Endereço",
                            "Contato",
                          ][i]
                        }
                        <input
                          name={f}
                          required={i < 3}
                          defaultValue={
                            modal.startsWith("editar:")
                              ? (data.organizations || data.schools).find(
                                  (s: any) => s.id === modal.split(":")[1],
                                )?.[f]
                              : ""
                          }
                        />
                      </label>
                    ),
                  )}
                  <button className="primary" disabled={busy}>
                    {modal.startsWith("editar:")?"Salvar cadastro":"Salvar escola"}
                  </button>
                </form>
                {modal.startsWith("editar:") && (
                  <form
                    onSubmit={(e) =>
                      submit(
                        e,
                        (b) =>
                          api(
                            "/schools/" +
                              modal.split(":")[1] +
                              "/representatives",
                            b,
                          ),
                        "Representante cadastrado.",
                      )
                    }
                  >
                    <h3>Adicionar representante</h3>
                    <label>
                      Nome
                      <input name="name" required />
                    </label>
                    <label>
                      E-mail
                      <input name="email" type="email" required />
                    </label>
                    <button className="secondary">
                      Cadastrar representante
                    </button>
                  </form>
                )}
              </>
            ) : modal === "modelo" ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const form = new FormData(e.currentTarget);
                  await action(async () => {
                    await api("/templates", form);
                    setModal("");
                  }, "Modelo cadastrado como rascunho.");
                }}
              >
                <label>
                  Nome do modelo
                  <input name="name" required />
                </label>
                <label>
                  Tipo do documento
                  <select name="document_type">
                    {[
                      "Contrato de garantia",
                      "Contrato educacional",
                      "Contrato fornecedor",
                      "Contrato marketing",
                      "Aditivo",
                      "CNPJ solidário",
                      "Antecipação K-invest",
                      "Parcelamento",
                      "Migração de modalidade",
                      "Distrato",
                      "Descredenciamento",
                      "Renovação com pendências",
                      "Alteração societária",
                    ].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Modelo específico de aditivo
                  <select name="subtype">
                    <option value="">Não aplicável</option>
                    {[
                      "Conta bancária",
                      "Vigência",
                      "Percentual/data de repasse",
                      "Cashback",
                      "Taxa de remuneração",
                    ].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Modalidade (modelos estruturados de contrato)
                  <select name="modality">
                    <option value="">Não aplicável</option>
                    <option>Garantia Completa</option>
                    <option>Garantia Conjunta</option>
                    <option>Garantia Prevista</option>
                  </select>
                </label>
                <label>
                  Natureza da versão
                  <select name="demonstration">
                    <option value="true">
                      Demonstração — sem aprovação jurídica
                    </option>
                    <option value="false">
                      Modelo oficial a ser submetido ao Jurídico
                    </option>
                  </select>
                </label>
                <label>
                  Criar nova versão de
                  <select name="template_id">
                    <option value="">Novo modelo</option>
                    {data.templates
                      .filter(
                        (t: any, i: number, a: any[]) =>
                          a.findIndex((x) => x.id === t.id) === i,
                      )
                      .map((t: any) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Arquivo DOCX (máximo 5 MB)
                  <input name="file" type="file" accept=".docx" required />
                </label>
                <button className="primary" disabled={busy}>
                  Cadastrar rascunho
                </button>
              </form>
            ) : modal === "senha" ? (
              <form
                onSubmit={(e) =>
                  submit(e, async (b) => {
                    if (b.password !== b.confirm) throw Error("A confirmação não confere com a nova senha.");
                    await api("/me/password", { current: b.current, password: b.password });
                    setModal("");
                  }, "Senha alterada. Outras sessões abertas foram encerradas.")
                }
              >
                <label>
                  Senha atual
                  <input name="current" type="password" autoComplete="current-password" required />
                </label>
                <label>
                  Nova senha (mínimo 12 caracteres)
                  <input name="password" type="password" autoComplete="new-password" minLength={12} required />
                </label>
                <label>
                  Confirme a nova senha
                  <input name="confirm" type="password" autoComplete="new-password" minLength={12} required />
                </label>
                <button className="primary" disabled={busy}>
                  Alterar senha
                </button>
              </form>
            ) : modal.startsWith("senha:") ? (
              <form
                onSubmit={(e) =>
                  submit(e, async (b) => {
                    await api("/users/" + modal.slice(6) + "/password", { password: b.password }, "PUT");
                    setModal("");
                  }, "Senha redefinida. Informe a nova senha à pessoa por um canal seguro; as sessões dela foram encerradas.")
                }
              >
                <label>
                  Nova senha (mínimo 12 caracteres)
                  <input name="password" type="password" autoComplete="new-password" minLength={12} required />
                </label>
                <p className="muted">Peça para a pessoa trocar a senha em "Alterar senha" no primeiro acesso.</p>
                <button className="primary" disabled={busy}>
                  Redefinir senha
                </button>
              </form>
            ) : (
              <form
                onSubmit={(e) =>
                  submit(e, async (b) => {
                    await api("/users", b);
                    setModal("");
                  })
                }
              >
                <label>
                  Nome
                  <input name="name" required />
                </label>
                <label>
                  E-mail
                  <input name="email" type="email" required />
                </label>
                <label>
                  Senha inicial (mínimo 12 caracteres)
                  <input
                    name="password"
                    type="password"
                    minLength={12}
                    required
                  />
                </label>
                <label>
                  Perfil
                  <select name="role">
                    {[
                      "Administrador",
                      "Solicitante",
                      "Operação",
                      "Jurídico",
                      "Aprovador",
                      "Consulta",
                      "Risco",
                      "Financeiro",
                    ].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <button className="primary" disabled={busy}>
                  Cadastrar usuário
                </button>
              </form>
            )}
            {error && (
              <p className="urgent" role="alert">
                {error}
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
