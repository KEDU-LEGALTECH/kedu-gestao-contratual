import { FileText, MessageSquare, Paperclip } from "lucide-react";

type Document = {id: string; name: string};
type Message = {id: string; author?: string; date?: string; text: string; documents: string[]};
type Props = {
  messages?: Message[];
  documents?: Document[];
  fallback?: string;
  partial?: boolean;
  approvalsPartial?: boolean;
  attachmentUrl?: (id: string) => string;
  imageUrl?: (id: string) => string | undefined;
};

function displayDate(date: string) {
  return date.replace(/^(\d{4})-(\d{2})-(\d{2})[ T]/, "$3/$2/$1 ").replace(/:\d{2}$/, "");
}

export function GlpiConversation({messages = [], documents = [], fallback, partial, approvalsPartial, attachmentUrl, imageUrl}: Props) {
  const entries = messages.length ? messages : fallback ? [{id: "initial", text: fallback, documents: []}] : [];
  const byId = new Map(documents.map(document => [String(document.id), document]));
  const linked = new Set(entries.flatMap(message => message.documents));
  const unlinked = documents.filter(document => !linked.has(String(document.id)));
  const attachments = (ids: string[]) => (
    <ul className="glpi-message-files">
      {ids.map(id => {
        const document = byId.get(id);
        if (!document) return null;
        const preview = imageUrl?.(id);
        const name = <><FileText size={17} aria-hidden="true" /><span>{document.name}</span></>;
        return <li key={id}>
          {attachmentUrl ? <a href={attachmentUrl(id)}>{name}</a> : <span>{name}</span>}
          {preview && <img src={preview} alt={document.name} loading="lazy" />}
        </li>;
      })}
    </ul>
  );

  return <section className="glpi-conversation" aria-label="Conversa do chamado no GLPI">
    {partial && <p className="muted">Algumas origens do histórico estão indisponíveis para a integração.</p>}
    {approvalsPartial && <p className="muted">Cobertura parcial: a integração não conseguiu consultar todas as aprovações.</p>}
    {!!entries.length && <ol className="glpi-thread">
      {entries.map(message => {
        const kind = message.id === "initial" ? "Solicitação inicial" : message.id.startsWith("TicketTask:") ? "Tarefa" : message.id.startsWith("ITILSolution:") ? "Solução" : message.id.startsWith("TicketValidation:") ? "Aprovação" : "Acompanhamento";
        const initials = message.author?.split(/\s+/).slice(0, 2).map(part => part[0]).join("");
        return <li className="glpi-thread-entry" key={message.id}>
          <span className="glpi-message-avatar" aria-hidden="true">{initials || <MessageSquare size={17} />}</span>
          <article className="glpi-message">
            <header><strong>{message.author || kind}</strong>{message.author && <span>{kind}</span>}
              {message.date && <time dateTime={message.date.replace(" ", "T")}>{displayDate(message.date)}</time>}
            </header>
            {message.text && <div className="glpi-message-text">{message.text}</div>}
            {!!message.documents.length && attachments(message.documents)}
          </article>
        </li>;
      })}
    </ol>}
    {!!unlinked.length && <div className="glpi-unlinked-files">
      <h4><Paperclip size={16} aria-hidden="true" /> Anexos sem mensagem identificada</h4>
      {attachments(unlinked.map(document => String(document.id)))}
    </div>}
    {!entries.length && !documents.length && <p className="muted">Conversa indisponível.</p>}
  </section>;
}
