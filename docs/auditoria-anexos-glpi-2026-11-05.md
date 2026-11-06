# Auditoria de anexos e pendências GLPI — 05/11/2026

Medição base: 05/11/2026, 12:52 a 13:05 (Brasília), com a fila ativa e somente leitura.
O texto identifica casos por número do chamado e ID do documento, sem nomes de arquivos nem valores.

> **Atenção:** os números abaixo são de antes da leitura completa da conversa aplicada à tarde,
> que alterou chamados, versões e status. Use-os como linha de base e repita a medição quando a fila esvaziar.

## Conclusão

Não há causa única.

- **Documentos não lidos:** a sincronização não enumerava anexos do histórico. Eram 151 de 430 vínculos conhecidos (35%), ou 148 de 420 documentos únicos, em 57 de 134 chamados. Dos 279 vínculos diretos, 265 foram lidos por completo, nenhum ficou sem bytes e 14 têm falha ou leitura parcial. Portanto, o OCR não era a causa principal.
- **Campos pendentes:** o bloqueio mais frequente é a conferência por arquivo, presente em 51 de 79 demandas em "Aguardando análise". As tabelas de confirmação humana tinham 0 registros.
- **Contagem inflada:** 24 das 79 demandas tinham chamado solucionado ou fechado no GLPI. As ativas eram 55.
- **Lacuna desta auditoria:** o texto da conversa também traz valores a comparar, e isso não foi medido aqui. A referência vinha só do formulário inicial (`request-expectations.ts`).

## Causas

As categorias se sobrepõem; não some os totais. Linhas referem-se ao código de 05/11, antes das alterações da tarde.

| # | Causa | Etapa | Impacto na medição base | Código | Situação em 05/11 |
|---|---|---|---|---|---|
| 1 | Histórico não enumerado | Descoberta e download | 151/430 vínculos; 57/134 chamados; 31/79 em análise | `glpi.ts:119`, `:387`; `glpi-download.ts:26-28` | Em correção à tarde; conferir o resultado |
| 2 | Rótulo falso de "Arquivo não enviado" | Apresentação | 20 campos em 6 chamados com anexos no histórico | `document-evidence.ts:68`; `pending-reason.ts:9` | Aberto |
| 3 | Conferência por arquivo | Conferência | 99 pendências em 56 chamados; 44 sem campo aproveitado | `contract-processing.ts:108`, `:233`; `reading-policy.ts:49` | Aberto; decisão de negócio |
| 4 | Campo não associado | Associação | 110 campos ausentes; em 38 o valor aparece no texto (busca textual, pode ter falso positivo) | `guided-confirmation.ts:72`; `pending-reason.ts:15` | Aberto |
| 5 | Fila sem nova tentativa | Extração | 13 de 14 arquivos com falha sem caminho automático | `reading-job-queue.ts:14`, `:27` | Aberto |
| 6 | Falhas e leituras parciais | Extração | 14/279 vínculos; 76/385 páginas com OCR não concluído | `file-reading-engine.ts:28`, `:203`; `pdf-reading-policy.ts:36` | Aberto |
| 7 | Referência ambígua sem saída | Conferência | 16 campos em 16 chamados | `contract-processing.ts:217` | Aberto |
| 8 | Validação sem rota de liberação | Conferência | 22 achados em 9/79 demandas | `contract-processing.ts:239`; `processing-status.ts:2` | Aberto |
| 9 | Encerrados misturados às pendências | Apresentação | 24/79 | `index.ts`; `glpi-ticket-meta.ts` | **Corrigido** (`30e31f2`) |
| 10 | Sincronização frágil | Descoberta | 25 falhas e 22 sucessos em 14 dias | `glpi.ts:285`; `GLPI_RETRIES=0`; `glpi-sync.ts:41` | Aberto |
| 11 | Versão nova descartava confirmações | Versão | 186 mudanças de versão; 0 confirmações perdidas | `contract-processing.ts` | **Corrigido** (`1e14bbd`) |

## Sem efeito na medição base

- Registros sem bytes e cópias só de versão anterior: 0.
- Limite de 20 anexos: sem efeito (máximo de 14 por chamado), mas o corte em `contract-processing.ts:324` deixaria o 21º permanentemente de fora.
- Limite de 20 MB: 0 de 151; o maior tem 9,24 MB. Os 151 responderam HTTP 200, com checksum idêntico.
- Camada digital dos PDFs: 158 PDFs e 719 páginas, nenhuma página digital pendente; 385 páginas exigem OCR e 309 foram concluídas.

## Estados que devem ser distinguidos

| Estado | Critério |
|---|---|
| Arquivo não enviado | Todas as origens consultadas, sem negação, e nenhum anexo pode conter o dado. Com origem negada, é "cobertura parcial" |
| Ainda não importado | Existe no GLPI, mas não no projeto, ou está no projeto sem registro de arquivo |
| Download falhou | Registro com 0 bytes e motivo ou código HTTP |
| Leitura parcial | Há bytes e o arquivo está incompleto ou tem páginas pendentes listadas; não usar mensagem de "em branco" |
| Valor encontrado sem associação | Fonte lida por completo, valor localizado com trecho e página, sem rótulo ou entidade que o liguem ao campo. Nunca conta como "confere" |

## Riscos a conferir na correção da tarde

Vêm da leitura do código, não de falhas observadas.

1. **Tempo:** a leitura completa da linha do tempo pode ultrapassar os 600 s da sincronização (`glpi-sync.ts`). Um inventário completo levou 762 s, incluindo downloads de checksum.
2. **HTTP 403:** `TicketValidation` responde 403 nos 134 chamados. Em `readTicketTimeline`, isso parece marcar `documentsAvailable=false`; o correto é cobertura parcial.
3. **Aprovações:** 61 de 134 chamados têm aprovação registrada, e seus anexos não puderam ser enumerados. Nos outros 73 não há aprovação.
4. **Versões:** anexos do histórico podem ser versões novas de documentos diretos. Misturá-los pode gerar conflitos falsos.
5. **Conversas privadas:** confirmar se o texto guardado não aparece nem é usado indevidamente.

## Referência: implementação alternativa

O branch `feat/anexos-historico` (`82abc15`) não está aplicado. Serve de referência para: enumeração com orçamento de tempo, cobertura parcial, hash estável quando não há anexo novo e revalidação da origem no download.

Em uma simulação em cópia do banco, interrompida antes do fim, o orçamento de 480 s enumerou só 21, 37 e 50 chamados em três sincronizações. Portanto, uma enumeração incremental precisaria de mais tempo por execução ou de uma carga inicial separada.

## Sequência sugerida a partir daqui

1. Concluir e commitar a leitura completa da conversa, tratando os riscos acima.
2. Quando a fila esvaziar, repetir esta medição na mesma coorte, comparando por ID.
3. Reabrir jobs presos e corrigir a mensagem de estouro de tempo (causas 5 e 6).
4. Criar saídas registradas para validação e referência ambígua (causas 7 e 8).
5. Decidir a regra de arquivo lido sem campo aproveitado (causa 3).
6. Tolerar falha por chamado na sincronização (causa 10).

## Decisões tomadas em 05/11/2026

Decisões 1, 2 e 3 implementadas em 06/11/2026. A decisão 4 depende do administrador do GLPI.

1. **Arquivo lido por completo, sem campo aproveitado:** não bloqueia a demanda, desde que todos os campos pedidos estejam resolvidos por outra fonte e o arquivo fique visível como "não utilizado".
2. **Chamados solucionados e fechados:** pausar a leitura automática, permitir releitura manual e religar a leitura se o chamado for reaberto.
3. **Versões de um mesmo documento:** manter todas e comparar pela mais recente só quando o vínculo entre elas estiver claro; nos demais casos, escolha humana.
4. **Permissão de leitura de aprovações no GLPI:** será solicitada ao administrador. Até lá, chamados com aprovação registrada ficam com cobertura parcial.
