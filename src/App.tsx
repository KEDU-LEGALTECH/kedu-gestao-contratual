import React, { useEffect, useState } from "react";

import {
  LayoutDashboard,
  Files,
  School,
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
  ShieldCheck,
  Columns3,
  List,
  Inbox,
  FileText,
  Link2,
} from "lucide-react";
import "./style.css";
import { Reports } from "./Reports";
import { GovernancePanel, SignedHistoryPanel } from "./GovernancePanel";
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
  cashback: "Cashback",
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
async function api(path: string, body?: any, method?: string) {
  const r = await fetch("/api" + path, {
    method: method || (body ? "POST" : "GET"),
    headers:
      body instanceof FormData ? {} : { "Content-Type": "application/json" },
    body:
      body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error);
  return data;
}
const Badge = ({ stage }: { stage: string }) => (
  <span className={"badge stage-" + stages.indexOf(stage)}>
    <i />
    {stage}
  </span>
);
const nav = [
  ["Dashboard", LayoutDashboard],
  ["Demandas", Files],
  ["Escolas", School],
  ["Contratos e aditivos", FileCheck2],
  ["Modelos", BookOpen],
  ["Relatórios", ChartNoAxesCombined],
  ["Configurações", Settings],
] as const;
export function App() {
  const [user, setUser] = useState<any>(null),
    [data, setData] = useState<any>(null),
    [page, setPage] = useState("Dashboard"),
    [detail, setDetail] = useState<any>(null),
    [modal, setModal] = useState(""),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    [query, setQuery] = useState(""),
    [stage, setStage] = useState(""),
    [owner, setOwner] = useState(""),
    [priority, setPriority] = useState(""),
    [type, setType] = useState(""),
    [deadline, setDeadline] = useState(""),
    [kanban, setKanban] = useState(false),
    [mobile, setMobile] = useState(false);
  const can = (p: string) => user?.permissions.includes(p);
  async function load() {
    setData(await api("/bootstrap"));
  }
  useEffect(() => {
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
    } finally {
      setBusy(false);
    }
  }
  async function open(id: string) {
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
              defaultValue="admin@demo.kedu.local"
            />
          </label>
          <label>
            Senha
            <input
              name="password"
              type="password"
              required
              defaultValue="Kedu-demo-2026!"
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
          <small>
            Ambiente demonstrativo • Dados fictícios
            <br />
            Contas e perfis disponíveis no README.
          </small>
        </form>
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
  const filtered = data.demands.filter(
    (d: any) =>
      (!query ||
        [d.school, d.data.cnpj, d.glpi_id, d.id]
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase())) &&
      (!stage || d.stage === stage) &&
      (!owner || d.owner === owner) &&
      (!priority || d.priority === priority) &&
      (!type || d.type === type) &&
      (!deadline ||
        (deadline === "overdue"
          ? d.due <
              new Intl.DateTimeFormat("en-CA", {
                timeZone: "America/Sao_Paulo",
              }).format(new Date()) &&
            !["Concluído", "Cancelado"].includes(d.stage)
          : d.due >=
            new Intl.DateTimeFormat("en-CA", {
              timeZone: "America/Sao_Paulo",
            }).format(new Date()))),
  );
  const table = (rows: any[], compact = false) => (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Escola / demanda</th>
            <th>Documento</th>
            <th>Etapa</th>
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
                </small>
              </td>
              <td>
                {d.type}
                <small className={d.priority === "Urgente" ? "urgent" : ""}>
                  {d.priority === "Urgente" ? "● " : ""}
                  {d.priority}
                </small>
              </td>
              <td>
                <Badge stage={d.stage} />
              </td>
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
                  d.due <
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
                  {d.due <
                    new Intl.DateTimeFormat("en-CA", {
                      timeZone: "America/Sao_Paulo",
                    }).format(new Date()) &&
                  !["Concluído", "Cancelado"].includes(d.stage)
                    ? "Prazo vencido"
                    : ""}
                </small>
              </td>
              <td>
                <ChevronRight size={17} />
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
          <span className="environment">
            <i /> Ambiente de demonstração
          </span>
        </header>
        <main>
          <div className="demo-banner">
            <span>
              <span className="demo-dot" /> Modo demonstração — GLPI não
              conectado
            </span>
            <button
              onClick={() => {
                setPage("Configurações");
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
          {detail ? (
            <>
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
                      data.schools.find((s: any) => s.id === detail.school_id)
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
              <div className="detail-grid">
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Dados e condições comerciais</h2>
                    <span
                      className={"badge " + (detail.confirmed ? "ok" : "warn")}
                    >
                      {detail.confirmed
                        ? "Confirmados"
                        : "Confirmação pendente"}
                    </span>
                  </div>
                  <form
                    onSubmit={(e) =>
                      submit(
                        e,
                        (b) => {
                          const output = {
                            ...b,
                            checklist: b.checklist === "on",
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
                    <div className="form-grid">
                      {Object.entries(labels)
                        .filter(
                          ([key]) =>
                            can("bank") ||
                            !["banco", "agencia", "conta"].includes(key),
                        )
                        .map(([key, label]) => (
                          <label key={key}>
                            {label}
                            {key === "modalidade" ? (
                              <select
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
                            ) : (
                              <input
                                name={key}
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
                          </label>
                        ))}
                    </div>
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
                    {can("write") && (
                      <button className="secondary" disabled={busy}>
                        Salvar dados
                      </button>
                    )}
                  </form>
                  {can("confirm") && (
                    <button
                      className="primary"
                      disabled={busy || detail.confirmed}
                      onClick={() =>
                        action(
                          () => api("/demands/" + detail.id + "/confirm", {}),
                          "Dados críticos confirmados.",
                        )
                      }
                    >
                      Confirmar dados críticos
                    </button>
                  )}
                  {detail.missing.length > 0 && (
                    <div className="inline-warning">
                      Pendências:{" "}
                      {detail.missing
                        .map((s: string) => labels[s] || s)
                        .join(", ")}
                    </div>
                  )}
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
                          <select name="stage">
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
                          Escolas:
                            "Uma fonte de dados para cada escola parceira.",
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
                  {page === "Escolas" && can("write") && (
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
                        "Todas as etapas em andamento",
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
                        "Aguardando aprovação",
                        data.metrics.approval,
                        ShieldCheck,
                        "Prontas para decisão",
                        "purple",
                      ],
                      [
                        "Em assinatura",
                        data.metrics.signature,
                        FileCheck2,
                        "Na reta final",
                        "cyan",
                      ],
                    ].map(([title, value, Icon, caption, color]: any) => (
                      <button
                        className={"metric " + color}
                        key={title}
                        onClick={() => {
                          setPage("Demandas");
                          setDeadline(
                            title === "Prazos vencidos" ? "overdue" : "",
                          );
                          setStage(
                            title === "Aguardando aprovação"
                              ? "Em aprovação"
                              : title === "Em assinatura"
                                ? "Em assinatura"
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
                          <p>Distribuição das demandas por etapa</p>
                        </div>
                        <span className="counter">
                          {data.demands.length} demandas
                        </span>
                      </div>
                      <div className="flow-bars">
                        {stages.slice(0, 7).map((s, i) => {
                          const n = data.demands.filter(
                            (d: any) => d.stage === s,
                          ).length;
                          return (
                            <button
                              key={s}
                              onClick={() => {
                                setStage(s);
                                setPage("Demandas");
                              }}
                            >
                              <div className="bar-space">
                                <div
                                  className={"bar bar-" + i}
                                  style={{
                                    height:
                                      Math.max(
                                        8,
                                        (n /
                                          Math.max(
                                            1,
                                            ...stages.map(
                                              (x) =>
                                                data.demands.filter(
                                                  (d: any) => d.stage === x,
                                                ).length,
                                            ),
                                          )) *
                                          92,
                                      ) + "%",
                                  }}
                                >
                                  <span>{n}</span>
                                </div>
                              </div>
                              <small>
                                {s.replace(
                                  "Aguardando informações",
                                  "Aguardando info.",
                                )}
                              </small>
                            </button>
                          );
                        })}
                      </div>
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
                        <h2>Demandas que precisam de atenção</h2>
                        <p>
                          Priorize pendências e mantenha o fluxo em movimento.
                        </p>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => {
                          setPage("Demandas");
                          setStage("");
                        }}
                      >
                        Ver todas as demandas <ChevronRight size={16} />
                      </button>
                    </div>
                    {table(
                      data.demands
                        .filter(
                          (d: any) =>
                            !["Concluído", "Cancelado"].includes(d.stage),
                        )
                        .sort((a: any, b: any) => a.due.localeCompare(b.due))
                        .slice(0, 5),
                      true,
                    )}
                  </section>
                  <div className="dashboard-note">
                    <ShieldCheck size={15} /> Dados fictícios para demonstração.
                    Modelos sem aprovação jurídica.
                  </div>
                </>
              )}
              {page === "Demandas" && (
                <>
                  <section className="panel filters">
                    <div className="filter-top">
                      <div className="search">
                        <Search size={18} />
                        <input
                          placeholder="Buscar por escola, CNPJ ou número GLPI"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                      </div>
                      <div className="segmented">
                        <button
                          className={!kanban ? "selected" : ""}
                          onClick={() => setKanban(false)}
                        >
                          <List size={17} /> Tabela
                        </button>
                        <button
                          className={kanban ? "selected" : ""}
                          onClick={() => setKanban(true)}
                        >
                          <Columns3 size={17} /> Kanban
                        </button>
                      </div>
                    </div>
                    <div className="filter-row">
                      <select
                        aria-label="Filtrar etapa"
                        value={stage}
                        onChange={(e) => setStage(e.target.value)}
                      >
                        <option value="">Todas as etapas</option>
                        {stages.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
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
                        {["Normal", "Alta", "Urgente"].map((s) => (
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
                        }}
                      >
                        Limpar
                      </button>
                    </div>
                  </section>
                  {kanban ? (
                    <div className="kanban">
                      {stages.map((s) => (
                        <section key={s}>
                          <h3>
                            {s}
                            <span>
                              {
                                filtered.filter((d: any) => d.stage === s)
                                  .length
                              }
                            </span>
                          </h3>
                          {filtered
                            .filter((d: any) => d.stage === s)
                            .map((d: any) => (
                              <button
                                className="kanban-card"
                                key={d.id}
                                onClick={() => open(d.id)}
                              >
                                <small>{d.id}</small>
                                <strong>{d.school}</strong>
                                <p>{d.type}</p>
                                <div>
                                  <span className="avatar tiny">
                                    {d.owner_name[0]}
                                  </span>
                                  {date(d.due)}
                                </div>
                              </button>
                            ))}
                        </section>
                      ))}
                    </div>
                  ) : (
                    <section className="panel">{table(filtered)}</section>
                  )}
                  <p className="muted">
                    {filtered.length} demandas encontradas. Etapas são alteradas
                    no detalhe com validação de pendências.
                  </p>
                </>
              )}
              {page === "Escolas" && (
                <>
                  <div className="search standalone">
                    <Search size={18} />
                    <input
                      placeholder="Buscar escola ou CNPJ"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                  <div className="school-grid">
                    {data.schools
                      .filter((s: any) =>
                        (s.name + s.cnpj)
                          .toLowerCase()
                          .includes(query.toLowerCase()),
                      )
                      .map((s: any) => (
                        <section className="panel school-card" key={s.id}>
                          <span className="school-icon">
                            <School size={24} />
                          </span>
                          <h2>{s.name}</h2>
                          <p>{s.legal_name}</p>
                          <small>
                            {s.cnpj}
                            <br />
                            {s.address}
                            <br />
                            {s.contact}
                          </small>
                          <div className="school-footer">
                            <span>
                              {
                                data.demands.filter(
                                  (d: any) => d.school_id === s.id,
                                ).length
                              }{" "}
                              demandas
                            </span>
                            <button
                              className="text-button"
                              onClick={() => {
                                setQuery(s.name);
                                setPage("Demandas");
                              }}
                            >
                              Ver demandas <ChevronRight size={14} />
                            </button>
                          </div>
                          {can("write") && (
                            <button
                              className="text-button"
                              onClick={() => setModal("editar:" + s.id)}
                            >
                              Editar cadastro e representantes
                            </button>
                          )}
                        </section>
                      ))}
                  </div>
                </>
              )}
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
                                  : "Contrato matriz"}
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
                  <div className="alert info">
                    <BookOpen size={19} /> MODELO DE DEMONSTRAÇÃO — SEM
                    APROVAÇÃO JURÍDICA. A aprovação no sistema é operacional.
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
                        {can("legal") && t.status === "rascunho" && (
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
                        <span className="badge warn">Não conectado</span>
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
                        A demonstração importa quatro solicitações fictícias em
                        duas páginas. Repetir a importação preserva registros e
                        alterações locais.
                      </p>
                      {can("sync") && (
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() =>
                            action(
                              () => api("/sync", {}),
                              "Sincronização demonstrativa concluída.",
                            )
                          }
                        >
                          <RefreshCw size={16} /> Sincronizar demonstração
                        </button>
                      )}
                      <div className="inline-warning">
                        Modo real bloqueado até confirmar a versão e API da
                        instalação. URL e tokens são configurados apenas no
                        servidor (.env).
                      </div>
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
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Usuário</th>
                            <th>E-mail</th>
                            <th>Perfil</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.users.map((u: any) => (
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
                        Nenhuma sincronização executada. Inicie uma importação
                        demonstrativa.
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
                      ? "Editar escola"
                      : modal === "modelo"
                        ? "Cadastrar modelo DOCX"
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
                  <select name="school_id" required>
                    {data.schools.map((s: any) => (
                      <option key={s.id} value={s.id}>
                        {s.name} — {s.cnpj}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="form-grid">
                  <label>
                    Tipo de documento
                    <select name="type">
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
                <label>
                  Contrato matriz (obrigatório para aditivo e operação jurídica
                  sobre contrato existente)
                  <select name="matrix">
                    <option value="">Selecione</option>
                    {data.contracts
                      .filter(
                        (c: any) => c.status === "Assinado" && !c.parent_id,
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
                              ? data.schools.find(
                                  (s: any) => s.id === modal.split(":")[1],
                                )?.[f]
                              : ""
                          }
                        />
                      </label>
                    ),
                  )}
                  <button className="primary" disabled={busy}>
                    Salvar escola
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
