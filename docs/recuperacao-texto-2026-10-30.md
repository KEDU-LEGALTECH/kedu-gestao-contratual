# Recuperação de campos no texto já extraído — 30/10/2026

Aplicado nas 107 demandas reais com processamento ativo, sem novo OCR, IA,
downloads do GLPI, alteração dos anexos ou criação de confirmações humanas.

## Mudanças

- Recuperação de cidade/estado no endereço explicitamente declarado como sede da
  empresa. Endereços residenciais, foro e células que misturam bairro/cidade não
  foram adotados como sede.
- Leitura dos cabeçalhos bancários com `Ag` e `Cc`, incluindo identificação
  explícita do banco. Nome do usuário na saudação não vira titular da conta.
- Concordância entre passes Tesseract e PaddleOCR pode confirmar um campo que já
  estava marcado como verificado, mesmo com média baixa da página. Cada passe
  precisa identificar um único valor pelo contexto, independentemente do GLPI.
- Uma leitura digital/confirmada conserva a certeza de uma divergência mesmo
  quando outro anexo repete o mesmo valor com OCR incerto.
- Um nome com mantenedora entre parênteses e o nome curto correspondente ficam
  para associação: não são aprovados nem acusados de erro por essa diferença.
- Recuperadores preservam conflitos entre seus resultados, sem escolher o valor
  que coincide com o pedido.

## Resultado aplicado

| Etapa | Antes | Depois |
|---|---:|---:|
| Aguardando análise | 61 | 60 |
| Aguardando correção | 12 | 13 |
| Sem erros | 34 | 34 |

Não houve liberação de uma demanda inteira como Sem erros nesta rodada.

| GLPI | Resultado nos campos |
|---|---|
| 2026101284 | Banco recuperado, ainda a conferir; agência e conta passaram a conferir. |
| 2026101911 | Agência e conta recuperadas, ainda a conferir. |
| 2026101729 | Cidade e estado recuperados da sede, ainda a conferir. |
| 2026102154 | Agência passou a conferir. |
| 2026092721 | Agência, conta e titular passaram a conferir. |
| 2026102396 | Razão social passou de leitura pendente para divergência identificada. |

Totais: cinco campos antes ausentes recuperados como leitura a conferir; seis
campos passaram a conferir; uma divergência antes pendente foi identificada.
As demandas que permaneceram em análise continuam com outras pendências.

## Auditoria e validação

- Backup íntegro: `data/backups/kedu-2026-10-30T14-17-50-689Z-74f612dd.sqlite`.
- Relatório por demanda/campo: `data/text-recovery-measurements/1793369911789-applied.json`.
- 292 testes passaram, incluindo integração com bancos temporários; build passou.
- A primeira execução da suíte no ambiente isolado teve falhas de conexão local;
  a execução final fora desse isolamento passou com concorrência limitada a dois.

O comando `npx tsx server/recompare-cached-text.ts` simula o recálculo. A opção
`--apply` cria backup verificado e atualiza somente os resultados/auditoria numa
transação. Os textos extraídos, correções manuais e revisões são preservados.

Próximas melhorias devem tratar os motivos que ainda bloqueiam as demandas;
esta rodada recupera associações, não demonstra melhoria na leitura de imagens.

## Etapa 2 — associação do valor localizado ao campo (12h30)

Depois do relatório acima, o código passou a tratar todo "valor do chamado
localizado no texto" como pendente (coincidir com o GLPI não basta). Isso
estava certo, mas, sem a etapa de associação, tirava demandas de Sem erros
mesmo quando o valor aparecia ao lado do rótulo correto.

Agora o valor localizado só confere quando há rótulo ou qualificação junto dele:

- Razão social: `Nome empresarial`, `Razão social`, `Denominada`, `Sociedade`,
  papel no contrato (`Contratada`, `Locadora`...) ou `..., inscrita no CNPJ` /
  `pessoa jurídica` logo depois.
- Nome fantasia: `Nome fantasia`, `Título do estabelecimento` (incluindo o
  layout do Cartão CNPJ), `usará a expressão`.
- CNPJ/CPF: rótulo `CNPJ`/`CPF` imediatamente antes do número.
- CEP: rótulo `CEP` em endereço da empresa (sede, estabelecida, pessoa
  jurídica). CEP em qualificação de sócio (residente, casado, portador...) não
  comprova o CEP da empresa.
- Considera nome quebrado em duas linhas e colunas separadas por espaços.

Continuam a conferir, com o motivo "valor sem associação comprovada": nome
fantasia usado como razão social (2026101590), "COLEGIO BATISTA" presente só
dentro de "COLEGIO BATISTA LTDA" (2026101911), cabeçalho de ordem de serviço
(2026101348), planilha de descredenciamento (2026100857), nome fantasia sem
rótulo em print bancário (2026102155), CEP de residência de sócio (2026101911)
e CEP em cartão ilegível (2026101274).

| Etapa | Antes | Depois |
|---|---:|---:|
| Sem erros | 33 | 33 |
| Aguardando análise | 64 | 65 |
| Aguardando correção | 11 | 11 |
| Analisando | 1 | 0 |

A demanda que estava em processamento (2026102274) terminou em análise; nenhuma
demanda saiu de Sem erros. Os números iniciais diferem da etapa 1 porque o banco
foi atualizado entre as rodadas.

- Backup: `data/backups/kedu-2026-10-30T15-32-27-008Z-737701e0.sqlite`.
- Relatório: `data/text-recovery-measurements/1793374373244-applied.json`.
- Fingerprint `hybrid-local-ocr-v24-guided-field-association`.
- 305 testes passaram; build concluído.

## Etapa 3 — fila de leitura automática (tarde)

Diagnóstico: a configuração `documentReadingPaused=true` (gravada direto no
banco; nenhuma tela a altera) mantinha parada a fila que baixa e lê anexos a
cada 60 s. 59 tarefas tinham desistido após 3 tentativas sem registrar motivo.

- O motivo passou a ser gravado em `reading_jobs.last_error`, por anexo
  (não baixado, download falhou com o erro do GLPI, leitura falhou, leitura
  parcial, lido sem campos). `npx tsx server/reading-job-diagnosis.ts`
  lista as tarefas paradas; `--apply` preencheu as 59 antigas como
  "Diagnóstico posterior".
- Causas encontradas: 69 anexos lidos sem campos reconhecidos, 25 não baixados
  (por causa da pausa), 12 leituras parciais, 11 imagens sem texto legível,
  nenhum erro de download do GLPI.
- Anexo lido por inteiro, com texto e sem campos reconhecidos, deixou de ser
  repetido (resultado seria o mesmo); fica para conferência.
- Com autorização da usuária: backup
  `data/backups/kedu-2026-10-30T16-48-28-587Z-05f9ab90.sqlite`, 7 tarefas
  com leitura parcial recolocadas na fila e pausa retirada. As imagens sem texto
  legível não foram recolocadas.

### Primeiro resultado da fila e correção de falsas divergências

Com a fila religada, os anexos novos foram baixados sem erro de download
(Aguardando análise 65 → 60), mas 4 demandas foram para correção por
divergências falsas. Propostas e termos anexos da Kedu trazem no cabeçalho
`NOME DA ESCOLA (CNPJ)`, com o nome comercial; a regra de 26/10 lia esse nome
como razão social. Agora, razão social que vem só desse cabeçalho, sem forma
jurídica, e difere do GLPI fica "a conferir" (motivo `trade_name`), não vira
correção. Sete demandas saíram de correção por esse motivo: 2026101798,
2026102095, 2026102396 (a "divergência identificada" da etapa 1 era desse tipo),
2026102447, 2026102500, 2026102523, 2026102538.

2026102590 continua em correção: o CNPJ vem do contrato social de outra
empresa do chamado ("Criativa"); os anexos da "Criativo" ainda estão na fila
(leitura adiada por falta de memória).

Backup `data/backups/kedu-2026-10-30T17-02-19-549Z-7e9bf223.sqlite`;
fingerprint v25. Resultado: Sem erros 33, Aguardando análise 68, Aguardando
correção 8; fila ainda em andamento.
