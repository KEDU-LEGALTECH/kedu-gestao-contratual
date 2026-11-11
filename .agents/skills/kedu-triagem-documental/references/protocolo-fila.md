# Protocolo de fila e medição

## Interfaces verificadas no projeto

Fonte de contrato: `server/hermes_document_mcp.py`, lista TOOLS. Confirmar schemas presentes no cliente antes de chamar. Prefixos podem variar: `hermes_documentos` no Codex e `kedu_documentos` no Hermes local são configurações registradas, não garantia de disponibilidade nesta sessão.

- list_pending_demands: status é Aguardando análise ou Aguardando correção; limit de 1 a 100 no schema MCP; offset >= 0. Retorno: counts.pending_demands, counts.returned, demands, database_read_only e project_data_modified. Para Conferência parcial, usar o inventário somente leitura pelo status de `contract_processing` se o schema do MCP não aceitar o filtro.
- read_pending_batch: status, attachment_offset >= 0, max_documents de 1 a 12 (usar 1 a 3), fields opcionais de 1 a 30 rótulos. Retorno: documents, total_attachments, next_attachment_offset, complete. O resultado read significa que a chamada terminou, não leitura integral ou aprovação.
- read_project_document: path dentro do projeto, fields (1 a 30), page_numbers opcionais (até seis páginas numeradas a partir de 1).
- list_project_documents: query opcional, limit até 200; pesquisa índice exportado. O índice pode estar desatualizado e não substitui a relação demanda/chamado/anexos.

## Algoritmo para lote solicitado

1. Enumerar todas as páginas de demandas e persistir a lista de IDs do lote. Checar a etapa operacional antes de recuperar documentos.
2. Obter a relação de anexos atuais, deduplicada por (demanda, versão do chamado, document_id). Manter todos os vínculos mesmo ao reutilizar uma extração de bytes idênticos.
3. Começar attachment_offset=0. Acrescentar cada resposta ao relatório; nunca sobrescrever lotes anteriores. Continuar em next_attachment_offset retornado, inclusive quando o lote contiver not_cached/unsupported/too_large/failed. Interromper se o offset não avançar ou o serviço falhar repetidamente.
4. Campos do retorno: result=read/not_cached/unsupported/too_large/failed. Registrar distribuição exclusiva desses resultados e, separadamente, cobertura de páginas e pendências por campo. Não chamar todo result=read de documento integralmente lido.
5. O lote MCP não aceita page_numbers e a leitura inicial de PDF pode cobrir apenas as primeiras páginas. Recuperar páginas restantes por read_project_document em cópia original local identificada, ou pelo processamento integrado autorizado. Se a cópia não existir, registrar bloqueio, sem afirmar que o MCP aceita document_id como path.
6. complete=true cobre a enumeração de anexos, não garante leitura de todas as páginas. Conferir páginas totais conhecidas versus páginas examinadas por documento.
7. Reenumerar a coorte ao finalizar. Se a fila mudou, reconciliar por ID, informar itens novos/removidos e não atribuir alterações concorrentes à intervenção.

## Registro mínimo do lote

Data com fuso, origem do banco/índice, filtro, IDs fixados, versão do chamado, contagem inicial, anexos tentados, anexos em cache, falhas, páginas lidas/pendentes, campos confirmados com evidência, inconclusivos, divergências, próximos passos e gravações oficiais verificadas. Informar explicitamente quando não houve escrita.

## Critério de ganho

- Ganho de extração: campo antes sem valor agora tem valor independente e localizável no original.
- Ganho de conferência: campo antes inconclusivo agora possui prova suficiente e comparação válida.
- Divergência identificada: erro de preenchimento comprovado, não erro de OCR.
- Transição oficial de etapa: reconciliar a mesma coorte por ID, separando saídas para Conferência parcial, Sem erros e Aguardando correção. Separar ganho de extração, ganho de conferência automática e mudança de classificação. Uma tabela com campos em **Confere** só comprova a mudança da demanda quando a nova etapa também for verificada no fluxo oficial.
- Precisão: exige gabarito independente conferido. Percentual de coincidência com GLPI, autoconfiança do modelo ou contadores do sistema não mede acurácia por si só. Calcular com ferramenta e declarar denominador/amostra.

## Consulta somente leitura em WSL/Windows

Quando SQLite no WSL falhar com `sqlite3.OperationalError: disk I/O error` sobre banco ativo no volume Windows, tentar o Python nativo do Windows já instalado: abrir o caminho Windows com URI `mode=ro`, executar `PRAGMA query_only=ON` e usar transação de leitura para inventário consistente. Não importar `server/db.ts`, carregar .env, aplicar migrações, pausar fila ou mudar configurações para diagnosticar. Não usar `immutable=1`, copiar apenas o .sqlite de um banco ativo com WAL, nem inferir estado atual a partir de exportação antiga. Se o interpretador nativo também falhar, preservar o erro e pedir acesso/snapshot consistente.

Para ler originais armazenados, exportar apenas os anexos da coorte autorizada para relatório local, com hash de bytes e versão/extraction_hash. Conferir depois status/revision/result, hashes dos originais/extrações e contagens de revisões humanas. Uma leitura assistida fica separada do sistema. O renderer já existente `server/hermes_pdf_pages.mjs` pode ser executado com Node nativo Windows quando o canvas instalado não tem binding Linux; não reinstalar nem apagar node_modules/package-lock para um piloto.

## Medição consistente no Windows (verificado em 05 a 09/11/2026)

- Python nativo do Windows com `file:...kedu.sqlite?mode=ro`, `PRAGMA query_only=ON` e uma única transação de leitura (`BEGIN` ... `rollback`) por medição. Funciona com o servidor ativo e o WAL.
- Para simular uma mudança de regra: copiar o banco com a API de backup do SQLite (`sqlite3.connect(ro).backup(dest)`), nunca copiando o arquivo `.sqlite` sozinho. Recalcular cada demanda com `saveProcessingResult` primeiro no código atual e depois no novo (dois worktrees), sem OCR, e comparar status e campos por chamado. Apagar a cópia ao final.
- Scripts que importam `server/db.ts` aplicam migrações: só rodar contra a cópia (`DATABASE_PATH`), nunca contra o banco em uso.
- Informar a janela da medição: o banco muda durante a análise com a fila ativa.
- LGPD: não exibir imagens ou trechos com dados pessoais ao modelo. Para conferir um anexo, usar OCR local e devolver só sim/não por campo.

## Simulações com servidor já em execução

Antes de alterar leitores em uma pasta compartilhada com servidor em modo watch, descobrir se há rotina automática ativa e preferir worktree/cópia isolada do código para a simulação. Não pausar ou reiniciar o servidor sem autorização. Alterar código pode fazer uma rotina existente reavaliar resultados mesmo sem executar um comando --apply. Comparar tabelas operacionais, bytes dos originais, revisões e gabaritos antes/depois; distinguir alterações em updated, result e metadados de tentativas de alterações no conteúdo ou status. Registrar auditoria e concorrência observadas; não atribuir ganhos à intervenção nem alegar banco intacto quando o comparativo estrito divergir.

Uma melhoria na seleção da fonte não recupera automaticamente um campo nem reduz demandas pendentes. Relatar o efeito real por campo e demanda na mesma coorte. Se a suíte completa tiver erro de conexão HTTP local mas a execução direcionada passar, informar ambos; não anunciar suíte integralmente aprovada.

## Fontes locais para manutenção

`server/hermes_document_mcp.py`, `server/contract-processing.ts`, `server/reading-policy.ts`, `server/comparison-profile.ts`, `server/targeted-reading.ts`, `server/document-evidence.ts`, `server/processing-routes.ts`, `shared/official-fields.ts`, `docs/recuperacao-texto-2026-10-30.md`, `docs/piloto-cinco-demandas.md`. Documentação histórica pode estar superada: confirmar limites e comportamento no código atual antes de execução.
