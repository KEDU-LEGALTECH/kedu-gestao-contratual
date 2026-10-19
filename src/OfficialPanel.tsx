import React, { useState } from "react";
import { FileText, Download, ShieldCheck, TriangleAlert, Link2 } from "lucide-react";
import { officialInputs } from "../shared/official-fields";
type Props = {
  detail: any;
  labels: Record<string, string>;
  can: (p: string) => boolean;
  action: (fn: () => Promise<any>, message?: string) => Promise<void>;
  api: (path: string, body?: any, method?: string) => Promise<any>;
  busy: boolean;
};
const when = (value: string) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo",
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";
/** Official Canva model, responsibilities, data origin and GLPI closure for one demand. */
export function OfficialPanel({ detail, labels, can, action, api, busy }: Props) {
  const [closureNote, setClosureNote] = useState("");
  const [closureAttested, setClosureAttested] = useState(false);
  const official = detail.official || { templates: [], previews: [], missing: [], problems: [] };
  const responsibility = detail.requirements?.responsibility;
  const name = (key: string) => labels[key] || officialInputs[key] || key;
  const origins = Object.entries(detail.origins || {}) as [string, string][];
  return (
    <div className="two-columns">
      <section className="panel official-panel">
        <div className="panel-heading">
          <h2>Modelo oficial (Canva)</h2>
          <FileText size={18} aria-hidden="true" />
        </div>
        {!official.templates.length ? (
          <p className="muted">
            Não há modelo oficial cadastrado para este tipo de documento. Use o
            modelo demonstrativo ou envie a minuta para conferência.
          </p>
        ) : (
          official.templates.map((t: any) => (
            <div className="template-row" key={t.version_id}>
              <span className="file-icon">
                <FileText />
              </span>
              <div>
                <strong>{t.name}</strong>
                <small>
                  Versão {t.version}
                  {t.modality ? " • " + t.modality : ""} •{" "}
                  {t.homologated
                    ? "Homologado em " + when(t.homologated_at)
                    : "Pendente de homologação jurídica"}
                </small>
              </div>
              <span className={"badge " + (t.homologated ? "ok" : "warn")}>
                {t.homologated ? "Homologado" : "Pendente"}
              </span>
              {can("write") && can("bank") && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    action(
                      () =>
                        api("/demands/" + detail.id + "/preview", {
                          template_version: t.version_id,
                        }),
                      "Prévia gerada. Ela é somente para conferência e não pode seguir para assinatura.",
                    )
                  }
                >
                  Gerar prévia
                </button>
              )}
            </div>
          ))
        )}
        {(official.missing.length > 0 || official.problems.length > 0) && (
          <div className="inline-warning" role="status">
            <TriangleAlert size={16} aria-hidden="true" />{" "}
            {official.missing.length > 0 && (
              <>
                Campos do modelo a preencher:{" "}
                {official.missing.map(name).join(", ")}.{" "}
              </>
            )}
            {official.problems.join(" ")}
          </div>
        )}
        <p className="muted">
          A prévia marca os campos ausentes como “PENDENTE” e traz o aviso “NÃO
          UTILIZAR PARA ASSINATURA”. A minuta para assinatura só é gerada com a
          versão homologada pelo Jurídico, a partir dos dados confirmados.
        </p>
        {official.previews.length > 0 && (
          <>
            <h3>Prévias geradas</h3>
            {official.previews.map((p: any) => (
              <div className="document" key={p.id}>
                <FileText size={22} aria-hidden="true" />
                <div>
                  <strong>Prévia — não assinável</strong>
                  <small>
                    Dados v{p.data_version} • {p.author} • {when(p.created)}
                    {p.data_version !== detail.data_version
                      ? " • desatualizada"
                      : ""}
                  </small>
                </div>
                {can("files") && can("bank") && (
                  <a
                    aria-label="Baixar prévia"
                    href={"/api/previews/" + p.id + "/download"}
                  >
                    <Download size={17} />
                  </a>
                )}
              </div>
            ))}
          </>
        )}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>Responsáveis e origem</h2>
          <ShieldCheck size={18} aria-hidden="true" />
        </div>
        {responsibility && (
          <dl className="responsibility">
            <dt>Executa</dt>
            <dd>{responsibility.executa}</dd>
            <dt>Valida</dt>
            <dd>{(detail.requirements?.approvals || []).join(" + ")}</dd>
            <dt>Observadores</dt>
            <dd>{responsibility.observadores}</dd>
            <dt>Fonte</dt>
            <dd>{responsibility.fonte}</dd>
          </dl>
        )}
        {responsibility?.nota && <p className="muted">{responsibility.nota}</p>}
        <h3>Origem dos dados</h3>
        {detail.glpiTicket ? (
          <p className="muted">
            <Link2 size={14} aria-hidden="true" /> Importada do chamado GLPI #
            {detail.glpiTicket.external_id} ({detail.glpiTicket.mode === "real" ? "GLPI" : "demonstração"}).
            {detail.glpiTicket.state === "alterado após vínculo" && (
              <strong className="urgent">
                {" "}
                O chamado mudou após a importação: revise na tela Chamados GLPI.
              </strong>
            )}
          </p>
        ) : (
          <p className="muted">Demanda registrada manualmente.</p>
        )}
        {origins.length > 0 && (
          <ul className="origin-list">
            {origins.map(([key, origin]) => (
              <li key={key}>
                <strong>{name(key)}:</strong> {origin}
              </li>
            ))}
          </ul>
        )}
        <p className="muted">
          Demais campos: digitados e confirmados na central por pessoa
          responsável (ver histórico).
        </p>
        <h3>Encerramento no GLPI</h3>
        {detail.glpiClosure ? (
          <p className="positive">
            Registrado por {detail.glpiClosure.name} em{" "}
            {when(detail.glpiClosure.at)}: {detail.glpiClosure.note}
          </p>
        ) : detail.stage === "Concluído" ? (
          can("write") ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                action(
                  () =>
                    api("/demands/" + detail.id + "/glpi-closure", {
                      attested: closureAttested,
                      note: closureNote,
                    }),
                  "Encerramento no GLPI registrado.",
                );
              }}
            >
              <label>
                Referência (ex.: data e quem anexou/encerrou)
                <input
                  value={closureNote}
                  onChange={(e) => setClosureNote(e.target.value)}
                  minLength={5}
                  required
                />
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={closureAttested}
                  onChange={(e) => setClosureAttested(e.target.checked)}
                />
                Anexei o documento assinado e encerrei o chamado diretamente no
                GLPI.
              </label>
              <button className="secondary" disabled={busy || !closureAttested}>
                Registrar encerramento externo
              </button>
            </form>
          ) : (
            <p className="muted">Aguardando registro do encerramento no GLPI.</p>
          )
        ) : (
          <p className="muted">
            A conclusão local exige o documento assinado. Anexar o assinado e
            encerrar o chamado continuam sendo feitos no GLPI (acesso somente
            leitura).
          </p>
        )}
      </section>
    </div>
  );
}
