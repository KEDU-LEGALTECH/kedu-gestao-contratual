import React from "react";
import { addendumFields, bankFields } from "../shared/request-policy";

export function AddendumComparison({
  detail,
  labels,
  can,
  busy,
  action,
  api,
}: any) {
  if (detail.type !== "Aditivo") return null;
  const keys = addendumFields[detail.subtype] || [];
  const current =
    detail.baseline?.subtype === detail.subtype ? detail.baseline : null;
  const allowed = !keys.some((key) => bankFields.includes(key)) || can("bank");
  const locked = ["Concluído", "Cancelado", "Em assinatura"].includes(
    detail.stage,
  );
  const format = (key: string, value: string) =>
    !value
      ? "Não informado"
      : ["inicio", "fim", "dataRepasse"].includes(key)
        ? value.split("-").reverse().join("/")
        : value;
  return (
    <section className="panel comparison-panel">
      <div className="panel-heading">
        <div>
          <h2>O que será alterado</h2>
          <p>
            {detail.subtype || "Defina o tipo de aditivo no controle jurídico."}
          </p>
        </div>
        <span className={"badge " + (current ? "ok" : "warn")}>
          {current ? "Retrato confirmado" : "Conferência da matriz pendente"}
        </span>
      </div>
      <p className="muted">
        Confira o contrato matriz e os aditivos assinados. A comparação abaixo
        usa os dados salvos; ela não consulta o GLPI ou o Clicksign.
      </p>
      {allowed ? (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Campo</th>
                  <th>Atual confirmado</th>
                  <th>Novo valor proposto</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((key) => (
                  <tr key={key}>
                    <td>{labels[key] || key}</td>
                    <td data-label="Atual confirmado">
                      {current ? format(key, current.data[key]) : "A confirmar"}
                    </td>
                    <td data-label="Novo valor proposto">
                      {format(key, detail.data[key])}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {current && (
            <p className="muted">
              Referência documental: {current.reference}. Confirmação em{" "}
              {new Intl.DateTimeFormat("pt-BR", {
                dateStyle: "short",
                timeStyle: "short",
                timeZone: "America/Sao_Paulo",
              }).format(new Date(current.created))}
              .
            </p>
          )}
          {can("confirm") && !locked && keys.length > 0 && (
            <details className="baseline-editor">
              <summary>
                {current
                  ? "Registrar nova conferência dos dados atuais"
                  : "Conferir e registrar os dados atuais"}
              </summary>
              <p>
                Transcreva os valores vigentes do histórico assinado. Meses sem
                dia definido precisam de esclarecimento. Esta confirmação não
                aprova a alteração proposta.
              </p>
              <form
                key={detail.id + detail.data_version + detail.subtype}
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = Object.fromEntries(
                    new FormData(event.currentTarget),
                  );
                  action(
                    () =>
                      api(
                        "/demands/" + detail.id + "/baseline",
                        {
                          expected_version: detail.data_version,
                          reference: form.reference,
                          attested: form.attested === "on",
                          data: Object.fromEntries(
                            keys.map((key) => [key, String(form[key] || "")]),
                          ),
                        },
                        "PUT",
                      ),
                    "Dados atuais confirmados. Confirme novamente a proposta antes de gerar.",
                  );
                }}
              >
                <div className="form-grid">
                  {keys.map((key) => (
                    <label key={key}>
                      {labels[key] || key} atual
                      <input
                        name={key}
                        required={key !== "pix"}
                        type={
                          ["inicio", "fim", "dataRepasse"].includes(key)
                            ? "date"
                            : "text"
                        }
                        defaultValue={current?.data[key] || ""}
                      />
                    </label>
                  ))}
                </div>
                <label>
                  Referência do contrato e dos aditivos consultados
                  <input
                    name="reference"
                    minLength={10}
                    maxLength={500}
                    required
                    defaultValue={current?.reference || ""}
                    placeholder="Documento, versão e localização no histórico assinado"
                  />
                </label>
                <label className="checkbox">
                  <input name="attested" type="checkbox" required />
                  Conferi estes valores no contrato matriz e no histórico
                  assinado.
                </label>
                <button className="secondary" disabled={busy}>
                  Confirmar dados atuais
                </button>
              </form>
            </details>
          )}
        </>
      ) : (
        <p>Dados bancários e comparação restritos ao seu perfil.</p>
      )}
    </section>
  );
}
