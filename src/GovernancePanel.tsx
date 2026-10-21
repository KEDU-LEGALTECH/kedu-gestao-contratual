import React, { useEffect, useState } from "react";
import {
  ShieldCheck,
  FileText,
  Download,
  Plus,
  Trash2,
  Clock,
  Link2,
} from "lucide-react";
type Props = {
  detail: any;
  can: (p: string) => boolean;
  action: (fn: () => Promise<any>, message?: string) => Promise<void>;
  api: (path: string, body?: any, method?: string) => Promise<any>;
  busy: boolean;
};
const formatDate = (value: string) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo",
      }).format(new Date(value + "T12:00:00Z"))
    : "—";
export function GovernancePanel({ detail, can, action, api, busy }: Props) {
  const [state, setState] = useState<any>(),
    [catalog, setCatalog] = useState<any>(),
    [draft, setDraft] = useState<any>(),
    [error, setError] = useState("");
  const [issues, setIssues] = useState<
    {
      location: string;
      problem: string;
      correction: string;
      severity: string;
    }[]
  >([]);
  const locked = ["Concluído", "Cancelado", "Em assinatura"].includes(
    detail.stage,
  );
  async function refresh() {
    const [g, c] = await Promise.all([
      api("/demands/" + detail.id + "/governance"),
      api("/governance/catalog"),
    ]);
    setState(g);
    setCatalog(c);
    setDraft({
      ...g.details,
      expected_version: g.data_version,
      subtype: g.details.subtype || "",
      reportDate: g.details.reportDate || c.reportDate,
      signingMode: g.details.signingMode || "Administrador nomeado",
      partnerCount: g.details.partnerCount || 1,
      signers: g.details.signers?.length
        ? g.details.signers
        : [{ name: "", email: "", capacity: "Administrador" }],
      legalFlags: g.details.legalFlags || [],
    });
  }
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, [
    detail.id,
    detail.data_version,
    detail.stage,
    detail.reviews?.length,
    detail.approvals?.length,
    detail.history?.length,
  ]);
  const act = (fn: () => Promise<any>, message: string) =>
    action(async () => {
      await fn();
      await refresh();
    }, message);
  if (error)
    return (
      <div className="alert error" role="alert">
        {error}
        <button
          onClick={() => {
            setError("");
            refresh().catch((e) => setError(e.message));
          }}
        >
          Tentar novamente
        </button>
      </div>
    );
  if (!state || !catalog || !draft)
    return (
      <section className="panel" role="status">
        Carregando controles jurídicos…
      </section>
    );
  return (
    <>
      <section className="panel governance-summary">
        {['Em assinatura','Concluído'].includes(detail.stage) && <div className="inline-warning"><strong>Registro externo no GLPI</strong><p>A conclusão aqui não encerra o chamado. Após confirmar a assinatura, uma pessoa autorizada deve anexar o documento assinado e registrar a conclusão no GLPI. A integração prevista é somente de leitura.</p></div>}
        <div className="panel-heading">
          <div>
            <h2>
              <ShieldCheck size={18} /> Controle jurídico e documental
            </h2>
            <p>
              {state.requirements.legal
                ? "Fluxo com controle jurídico obrigatório"
                : "Aditivo padronizado com autonomia da operação autorizada"}
            </p>
          </div>
          <span className="badge">
            Validações: {state.requirements.approvals.join(" + ")}
          </span>
        </div>
        <div className="governance-sla">
          <Clock size={17} />
          <span>
            Revisão até{" "}
            {state.requirements.reviewDeadline
              ? formatDate(state.requirements.reviewDeadline)
              : "definir quinta-feira"}{" "}
            • Reporte {formatDate(draft.reportDate)}
          </span>
        </div>
        {state.history.length > 0 && (
          <>
            <h3>Histórico assinado da matriz</h3>
            {state.history.map((h: any) => (
              <p className="muted" key={h.sequence}>
                {h.sequence === 0
                  ? "Contrato matriz"
                  : h.sequence + "º aditivo"}{" "}
                • {h.source} • {formatDate(h.signature_date)} • {h.reference}
              </p>
            ))}
          </>
        )}
        {state.confirmations?.length > 0 && (
          <>
            <h3>Consultas externas declaradas</h3>
            {state.confirmations.map((h: any, i: number) => (
              <p className="muted" key={i}>
                {h.source} • Último número {h.sequence} • {h.reference}
              </p>
            ))}
          </>
        )}
        {state.details.systemLegalFlags?.length > 0 && (
          <p className="urgent">
            Controle jurídico obrigatório detectado pelo sistema:{" "}
            {state.details.systemLegalFlags.join(", ")}. Este encaminhamento não
            pode ser removido pelo formulário.
          </p>
        )}
        {state.missing.length > 0 ? (
          <div className="inline-warning">
            <strong>Antes de confirmar e aprovar</strong>
            <ul>
              {state.missing.map((m: string) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="positive">
            Dados de governança e evidências obrigatórias completos.
          </p>
        )}
      </section>
      <div className="two-columns">
        <section className="panel">
          <h2>Origem e responsáveis pela assinatura</h2>
          <p className="muted">
            A referência abaixo é declarada manualmente. GLPI não conectado; não
            há consulta ou alteração de chamados.
          </p>
          {can("write") && !locked && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const b = Object.fromEntries(new FormData(e.currentTarget));
                act(
                  () =>
                    api("/demands/" + detail.id + "/glpi-reference", {
                      number: b.number,
                      attested: b.attested === "on",
                    }),
                  "Referência GLPI registrada. Confirmação dos dados reiniciada.",
                );
              }}
            >
              <label>
                <Link2 size={14} /> Número do chamado GLPI
                <input
                  name="number"
                  defaultValue={detail.glpi_id || ""}
                  required
                  pattern="[A-Za-z0-9_-]+"
                />
              </label>
              <label className="checkbox">
                <input type="checkbox" name="attested" required /> Conferi a
                referência na fonte e assumo responsabilidade por este vínculo.
              </label>
              <button className="secondary" disabled={busy}>
                Registrar referência
              </button>
            </form>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              act(
                () =>
                  api("/demands/" + detail.id + "/governance", draft, "PUT"),
                "Requisitos atualizados. Gere nova versão após confirmar os dados.",
              );
            }}
          >
            <div className="form-grid">
              {detail.type === "Aditivo" && (
                <label>
                  Tipo de aditivo
                  <select
                    value={draft.subtype}
                    disabled={locked || !can("write")}
                    onChange={(e) =>
                      setDraft({ ...draft, subtype: e.target.value })
                    }
                  >
                    <option value="">Selecione</option>
                    {catalog.subtypes.map((x: string) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Sexta-feira do reporte
                <input
                  type="date"
                  required
                  value={draft.reportDate}
                  disabled={locked || !can("write")}
                  onChange={(e) =>
                    setDraft({ ...draft, reportDate: e.target.value })
                  }
                />
              </label>
            </div>
            <label>
              Quem deve assinar pela escola?
              <select
                value={draft.signingMode}
                disabled={locked || !can("write")}
                onChange={(e) => {
                  const mode = e.target.value;
                  setDraft({
                    ...draft,
                    signingMode: mode,
                    signers: draft.signers.map((s: any) => ({
                      ...s,
                      capacity:
                        mode === "Administrador nomeado"
                          ? "Administrador"
                          : "Sócio",
                    })),
                  });
                }}
              >
                <option>Administrador nomeado</option>
                <option>Todos os sócios</option>
              </select>
            </label>
            {draft.signingMode === "Todos os sócios" && (
              <label>
                Quantidade de sócios com poderes
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={draft.partnerCount}
                  onChange={(e) =>
                    setDraft({ ...draft, partnerCount: Number(e.target.value) })
                  }
                  disabled={locked || !can("write")}
                />
              </label>
            )}
            {draft.signers.map((s: any, i: number) => (
              <div className="signer-row" key={i}>
                <label>
                  Nome do {s.capacity.toLowerCase()}
                  <input
                    required
                    value={s.name}
                    disabled={locked || !can("write")}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        signers: draft.signers.map((x: any, j: number) =>
                          j === i ? { ...x, name: e.target.value } : x,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  E-mail
                  <input
                    type="email"
                    required
                    value={s.email}
                    disabled={locked || !can("write")}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        signers: draft.signers.map((x: any, j: number) =>
                          j === i ? { ...x, email: e.target.value } : x,
                        ),
                      })
                    }
                  />
                </label>
                {!locked &&
                  can("write") &&
                  draft.signingMode === "Todos os sócios" &&
                  draft.signers.length > 1 && (
                    <button
                      type="button"
                      aria-label={"Remover signatário " + (i + 1)}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          signers: draft.signers.filter(
                            (_: any, j: number) => j !== i,
                          ),
                        })
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
              </div>
            ))}
            {!locked &&
              can("write") &&
              draft.signingMode === "Todos os sócios" && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      signers: [
                        ...draft.signers,
                        { name: "", email: "", capacity: "Sócio" },
                      ],
                    })
                  }
                >
                  <Plus size={15} /> Adicionar sócio
                </button>
              )}
            <h3>Situações que exigem Jurídico</h3>
            {[
              "Alteração do corpo fixo",
              "Alteração societária",
              "Renovação com pendências",
              "Renovação com contratos anteriores",
              "Outro caso jurídico",
            ].map((flag) => (
              <label className="checkbox" key={flag}>
                <input
                  type="checkbox"
                  checked={draft.legalFlags.includes(flag)}
                  disabled={locked || !can("write")}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      legalFlags: e.target.checked
                        ? [...draft.legalFlags, flag]
                        : draft.legalFlags.filter((f: string) => f !== flag),
                    })
                  }
                />
                {flag}
              </label>
            ))}
            {can("write") && !locked && (
              <button className="primary" disabled={busy}>
                Salvar requisitos e signatários
              </button>
            )}
          </form>
          <p className="muted">
            Os poderes devem ser conferidos por pessoa responsável no contrato
            social. Cadastrar um nome não comprova poderes.
          </p>
        </section>
        <section className="panel">
          <h2>Checklist de documentos</h2>
          <p className="muted">
            Cada documento precisa ser anexado e verificado. PDF é aceito como
            evidência; seu conteúdo não é conferido automaticamente.
          </p>
          {state.requirements.evidence.map((kind: string) => (
            <div className="evidence-block" key={kind}>
              <h3>{catalog.evidenceLabels[kind]}</h3>
              {state.evidence
                .filter((f: any) => f.kind === kind)
                .map((f: any) => (
                  <div className="evidence-row" key={f.id}>
                    <FileText size={18} />
                    <div>
                      <strong>{f.name}</strong>
                      <small>
                        {f.verified_by
                          ? "Verificado por pessoa responsável"
                          : "Aguardando verificação"}
                      </small>
                    </div>
                    {can("files") && can("bank") && (
                      <a
                        href={
                          "/api/demands/" +
                          detail.id +
                          "/evidence/" +
                          f.id +
                          "/download"
                        }
                        aria-label={"Baixar " + f.name}
                      >
                        <Download size={16} />
                      </a>
                    )}
                    {can("review") && !locked && !f.verified_by && (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          act(
                            () =>
                              api(
                                "/demands/" +
                                  detail.id +
                                  "/evidence/" +
                                  f.id +
                                  "/verify",
                                { attested: true },
                              ),
                            "Verificação humana registrada.",
                          )
                        }
                      >
                        Conferi o documento
                      </button>
                    )}
                  </div>
                ))}
              {can("files") && can("write") && !locked && (
                <label>
                  Adicionar evidência (DOCX/PDF até 8 MB)
                  <input
                    type="file"
                    accept=".docx,.pdf"
                    disabled={busy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        const b = new FormData();
                        b.append("file", f);
                        b.append("kind", kind);
                        act(
                          () => api("/demands/" + detail.id + "/evidence", b),
                          "Documento anexado. Agora registre a verificação humana.",
                        );
                      }
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
            </div>
          ))}
        </section>
      </div>
      {state.requirements.reviewDeadline &&
        state.requirements.reviewDeadline <
          new Intl.DateTimeFormat("en-CA", {
            timeZone: "America/Sao_Paulo",
          }).format(new Date()) && (
          <p className="urgent">
            Prazo semanal ultrapassado. Cada validação deverá registrar a
            justificativa do atraso.
          </p>
        )}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Relatório de revisão jurídica</h2>
            <p>{state.report.disclaimer}</p>
          </div>
          <span
            className={
              "badge " + (state.report.status === "REPROVADO" ? "warn" : "ok")
            }
          >
            {state.report.status}
          </span>
          {can("files") && can("bank") && (
            <a
              className="secondary"
              href={"/api/demands/" + detail.id + "/legal-report"}
            >
              <Download size={16} /> Exportar relatório
            </a>
          )}
        </div>
        <p className="muted">
          Minuta v{state.report.documentVersion || "—"} • Dados v
          {state.report.dataVersion}. Ressalvas só podem ser usadas para
          problemas menores; pendências críticas continuam bloqueadas.
        </p>
        <div className="review-axes">
          {state.report.axes.map((a: any) => (
            <article key={a.axis}>
              <h3>{a.axis}</h3>
              <p>
                {a.check
                  ? a.check.result + " — " + a.check.notes
                  : "Revisão humana pendente."}
              </p>
              {(a.check?.issues || []).map((i: any, j: number) => (
                <p
                  className={i.severity === "crítica" ? "urgent" : "muted"}
                  key={j}
                >
                  {i.location} → {i.problem} → {i.correction} ({i.severity})
                </p>
              ))}
              {a.check && (
                <small>
                  {a.check.name} •{" "}
                  {new Date(a.check.created).toLocaleString("pt-BR", {
                    timeZone: "America/Sao_Paulo",
                  })}
                </small>
              )}
            </article>
          ))}
        </div>
        {can("review") && !locked && (
          <form
            className="human-check"
            onSubmit={(e) => {
              e.preventDefault();
              const b = Object.fromEntries(new FormData(e.currentTarget));
              act(async () => {
                await api("/demands/" + detail.id + "/human-check", {
                  ...b,
                  issues,
                });
                setIssues([]);
              }, "Revisão humana registrada na versão exata.");
            }}
          >
            <div className="form-grid">
              <label>
                Eixo revisado
                <select name="axis">
                  {catalog.humanAxes.map((s: string) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label>
                Resultado
                <select name="result">
                  <option>Aprovado</option>
                  <option>Aprovado com ressalvas</option>
                  <option>Reprovado</option>
                </select>
              </label>
            </div>
            <label>
              Achados e orientação (localização → problema → correção)
              <textarea
                name="notes"
                minLength={10}
                required
                placeholder="Registre o que conferiu, os documentos consultados e as correções necessárias."
              />
            </label>
            <h3>Ocorrências da revisão</h3>
            <p className="muted">
              Ressalvas e reprovações exigem localização, problema e correção.
              Ocorrências críticas não podem ser aprovadas.
            </p>
            {issues.map((issue, i) => (
              <div className="finding" key={i}>
                <div className="form-grid">
                  {[
                    ["location", "Localização exata"],
                    ["problem", "Problema"],
                    ["correction", "Correção sugerida"],
                  ].map(([field, label]) => (
                    <label key={field}>
                      {label}
                      <input
                        required
                        minLength={3}
                        value={issue[field as keyof typeof issue]}
                        onChange={(e) =>
                          setIssues(
                            issues.map((x, j) =>
                              j === i ? { ...x, [field]: e.target.value } : x,
                            ),
                          )
                        }
                      />
                    </label>
                  ))}
                  <label>
                    Gravidade
                    <select
                      value={issue.severity}
                      onChange={(e) =>
                        setIssues(
                          issues.map((x, j) =>
                            j === i ? { ...x, severity: e.target.value } : x,
                          ),
                        )
                      }
                    >
                      <option value="menor">
                        Menor — redação ou formatação
                      </option>
                      <option value="crítica">
                        Crítica — impede assinatura
                      </option>
                    </select>
                  </label>
                </div>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setIssues(issues.filter((_, j) => i !== j))}
                >
                  Remover ocorrência
                </button>
              </div>
            ))}
            <button
              type="button"
              className="text-button"
              onClick={() =>
                setIssues([
                  ...issues,
                  {
                    location: "",
                    problem: "",
                    correction: "",
                    severity: "menor",
                  },
                ])
              }
            >
              <Plus size={15} /> Adicionar ocorrência
            </button>
            <br />
            <button className="secondary" disabled={busy}>
              Registrar revisão humana
            </button>
          </form>
        )}
      </section>
    </>
  );
}
export function SignedHistoryPanel({ contracts, can, action, api, busy }: any) {
  return can("risk") ? (
    <section className="panel">
      <h2>Confirmar histórico assinado antes de emitir aditivo</h2>
      <p className="muted">
        Consulte o Clicksign ou Clint e registre o último aditivo efetivamente
        assinado. Use zero quando houver apenas o contrato matriz. A confirmação
        fica imutável no histórico.
      </p>
      <form
        onSubmit={(e: any) => {
          e.preventDefault();
          const b = Object.fromEntries(new FormData(e.currentTarget));
          action(
            () =>
              api("/contracts/" + b.matrix + "/signed-history", {
                sequence: Number(b.sequence),
                source: b.source,
                reference: b.reference,
                signatureDate: b.signatureDate,
                attested: b.attested === "on",
              }),
            "Histórico assinado confirmado. A próxima numeração poderá ser reservada.",
          );
        }}
      >
        <div className="form-grid">
          <label>
            Contrato matriz
            <select name="matrix" required>
              {contracts
                .filter((c: any) => c.status === "Assinado" && c.instrument_kind === "Matriz")
                .map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.school} • {c.id}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Último número assinado
            <input name="sequence" type="number" required min={0} />
          </label>
          <label>
            Fonte
            <select name="source">
              <option>Clicksign</option>
              <option>Clint</option>
            </select>
          </label>
          <label>
            Data da última assinatura
            <input name="signatureDate" type="date" required />
          </label>
        </div>
        <label>
          Identificador ou referência verificada na fonte
          <input name="reference" required minLength={5} />
        </label>
        <label className="checkbox">
          <input name="attested" type="checkbox" required /> Consultei a fonte e
          confirmo o histórico assinado, não apenas uma minuta ou envio.
        </label>
        <button className="primary" disabled={busy}>
          Confirmar histórico assinado
        </button>
      </form>
    </section>
  ) : null;
}
