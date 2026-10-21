import React, { useEffect, useState } from "react";
import { FileText, ExternalLink, TriangleAlert } from "lucide-react";
import { documentConflicts } from "../shared/responsibility";
type Props = {
  data: any;
  can: (p: string) => boolean;
  action: (fn: () => Promise<any>, message?: string) => Promise<void>;
  api: (path: string, body?: any, method?: string) => Promise<any>;
  busy: boolean;
};
/** Official Canva adaptations: provenance, homologation by the legal team and open conflicts. */
export function OfficialTemplates({ data, can, action, api, busy }: Props) {
  const [items, setItems] = useState<any[]>([]),
    [target, setTarget] = useState(""),
    [reference, setReference] = useState(""),
    [attested, setAttested] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    api("/templates/official")
      .then(setItems)
      .catch((e) => setError(e.message));
  }, [data]);
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Modelos oficiais adaptados do Canva</h2>
        <span className="counter">{items.length}</span>
      </div>
      <p className="muted">
        Baixe o DOCX editável para abrir no Word ou importar no Google Docs (Arquivo → Abrir → Fazer upload). Os arquivos contêm campos de preenchimento; depois de editar no Docs, baixe em Microsoft Word (.docx) e envie a nova versão para conferência.
      </p>
      <p className="muted">
        Os modelos do Canva prevalecem. Estas versões trocam caixas posicionadas por parágrafos e tabelas para que o
        sistema preencha e confira cada campo; o texto é copiado da fonte e verificado palavra por palavra. Antes de
        gerar minutas para assinatura, o Jurídico precisa conferir uma prévia e homologar a versão exata.
      </p>
      {error && <p className="inline-warning">{error}</p>}
      {items.map((t) => (
        <div className="template-row" key={t.version_id}>
          <span className="file-icon">
            <FileText />
          </span>
          <div>
            <strong>{t.name}</strong>
            <small>
              {t.document_type}
              {t.subtype ? " • " + t.subtype : ""}
              {t.modality ? " • " + t.modality : ""} • Versão {t.version} • {t.previews} prévia(s) •{" "}
              {t.homologated_at
                ? `Homologado por ${t.homologated_by}: ${t.homologation_reference}`
                : "Pendente de homologação"}
            </small>
            {t.source_url?.startsWith("https://") && (
              <a href={t.source_url} target="_blank" rel="noreferrer noopener">
                Fonte no Canva <ExternalLink size={12} aria-hidden="true" />
              </a>
            )}
          </div>
          <span className={"badge " + (t.homologated_at ? "ok" : t.inactive ? "" : "warn")}>
            {t.inactive ? "Inativo" : t.homologated_at ? "Homologado" : "Pendente"}
          </span>
          {can("files") && <a className="secondary" href={`/api/templates/${t.version_id}/editable`}>Baixar DOCX editável</a>}
          {can("legal") && !t.homologated_at && !t.inactive && (
            <button className="secondary" onClick={() => setTarget(target === t.version_id ? "" : t.version_id)}>
              Homologar
            </button>
          )}
        </div>
      ))}
      {target && (
        <form
          className="homologation"
          onSubmit={(e) => {
            e.preventDefault();
            action(
              () => api("/templates/" + target + "/homologate", { reference, attested }),
              "Versão homologada. A homologação vale apenas para este arquivo e não pode ser desfeita.",
            ).then(() => setTarget(""));
          }}
        >
          <h3>Homologação jurídica</h3>
          <label>
            Referência da homologação (ata, parecer, chamado)
            <input value={reference} onChange={(e) => setReference(e.target.value)} minLength={10} required />
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
            Comparei a prévia gerada com o modelo do Canva (cláusulas, campos, ordem e layout) e aprovo esta versão
            exata para gerar minutas.
          </label>
          <button className="primary" disabled={busy || !attested}>
            Registrar homologação
          </button>
        </form>
      )}
      <h3>
        <TriangleAlert size={16} aria-hidden="true" /> Pontos para validação da equipe
      </h3>
      <ul className="pending-list">
        {documentConflicts.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
    </section>
  );
}
