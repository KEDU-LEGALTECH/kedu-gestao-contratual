export function MatrixImport({ detail, can, action, api, busy, onCreated }: any) {
  if (!can("risk") || !can("files") || !detail.school_id) return null;
  return <details className="pending-groups">
    <summary>Cadastrar contrato matriz assinado existente</summary>
    <p>Use para um contrato já assinado fora da Central. Confira a organização, o arquivo e o último aditivo no Clicksign/Clint. Este cadastro não envia documentos para assinatura.</p>
    <form onSubmit={e => {
      e.preventDefault();
      const form = e.currentTarget;
      const body = new FormData(form); body.set("attested", "true");
      action(async () => { const result = await api(`/demands/${detail.id}/matrices`, body); onCreated?.(result.id); form.reset(); }, "Matriz cadastrada com o histórico declarado. Selecione-a no recebimento.");
    }}>
      <label>Contrato assinado (PDF ou DOCX, até 8 MB)<input type="file" name="file" accept=".pdf,.docx" required /></label>
      <div className="form-grid">
        <label>Data de assinatura da matriz<input type="date" name="signatureDate" required /></label>
        <label>Último aditivo efetivamente assinado<input type="number" name="sequence" min="0" max="100000" step="1" required placeholder="0 se existir somente a matriz" /></label>
        <label>Histórico consultado em<select name="source" required defaultValue=""><option value="">Selecione</option><option>Clicksign</option><option>Clint</option></select></label>
        <label>Data de assinatura do último instrumento<input type="date" name="historyDate" required /></label>
      </div>
      <label>Referência do contrato e da consulta ao histórico<input name="reference" minLength={5} maxLength={300} required placeholder="Identificador ou referência que permita localizar os documentos conferidos" /></label>
      <p>Se informou zero aditivos, repita a data de assinatura da matriz. O próximo número será o último assinado + 1 e só será reservado na confirmação do aditivo.</p>
      <label><input type="checkbox" required /> Conferi a organização e o contrato assinado, as assinaturas exigidas e o último número assinado no serviço indicado.</label>
      <button className="secondary" disabled={busy}>Cadastrar matriz e histórico</button>
    </form>
  </details>;
}
