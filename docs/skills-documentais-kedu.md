# Skills documentais Kedu

## Entrega

Três módulos locais em `.agents/skills/` e instalados no perfil Hermes ativo na criação:

1. kedu-triagem-documental: identifica fila, anexos, versões e causas. Prioriza pendências recuperáveis sem repetir leituras inúteis.
2. kedu-leitura-precisa: lê formatos suportados com trecho, localizador, entidade e cobertura. Separa leitura integral de leitura dirigida por campo.
3. kedu-conferencia-documental: compara com GLPI sem copiar os valores solicitados para a extração. Distingue divergência comprovada, ausência de informação e leitura inconclusiva.

As referências incluem protocolo de paginação, fontes por campo/formato e JSON Schema do relatório auxiliar. O esquema não é contrato da API e não autoriza atualizar status. O exemplo Bernoli foi usado como referência de rigor e evidência, sem importar regras processuais ou dados de terceiros.

`AGENTS.md` orienta agentes abertos na raiz do projeto. A skill anterior `leitura-documentos` foi mantida e recebeu um encaminhamento para os módulos. Nenhuma configuração de MCP, credencial, modelo ou outro perfil foi alterada.

## Pedidos prontos

Diagnóstico inicial:

    Use kedu-triagem-documental no projeto Kedu. Inventarie Aguardando análise e Conferência parcial separadamente, fixe IDs/versões e separe causas por demanda/anexo/campo. Trabalhe somente leitura, sem baixar anexos ou alterar status. Informe os bloqueios e a ordem de tratamento.

Piloto de leitura, após o diagnóstico:

    Use as três skills documentais Kedu. Selecione cinco demandas da coorte diagnosticada, priorizando anexos em cache e poucos campos pendentes. Leia as fontes locais, confira os candidatos no original e entregue valores, entidade, trecho e cobertura. Não grave confirmações humanas nem resultados no sistema. Diferencie melhoria de leitura de redução oficial da fila.

Continuação de um lote já autorizado:

    Continue a partir dos IDs e offsets do relatório anterior. Não recomece a fila nem pule anexos com falha. Reconcilie mudanças na coorte e mantenha pendências sem evidência.

## Resultado esperado

Relatório por demanda e documento: campos encontrados e esperados separados, entidade/papel, arquivo/versão, página ou outro localizador, trecho, método, classificação, limitações e próxima ação. Totais calculados por ferramenta: demandas, anexos únicos, páginas e campos. Contagem de causas pode se sobrepor.

Ausências reais exigem pedir documentos ou esclarecimentos; OCR repetido não resolve falta de fonte. A redução da fila depende de execução e validação no fluxo oficial. Criar skills não executa automaticamente essa fila, não altera o motor de OCR e não comprova acurácia.

## Atualização 1.8.0 / 1.9.0 / 1.10.0 (23/11/2026)

- **Áreas das demandas (`kedu-triagem-documental` v1.8.0, `kedu-conferencia-documental` v1.10.0)**: "Tipo a confirmar" deixou de existir, por decisão da usuária; a demanda vai para uma área real e cita os anexos ainda não identificados. Nova área **Aguardando elaboração do contrato** para pedidos sem contrato preenchido (só apoio, propostas, relatórios ou modelos em branco). **Contrato não encontrado** e **Consulta ao GLPI incompleta** ficam para pedidos de análise contratual. Na simulação, "Contrato não encontrado" caiu de 53 para 2 demandas.
- **Leitura (`kedu-leitura-precisa` v1.9.0)**: identificação inconclusiva leva à leitura completa; foto lida com confiança sem estrutura de contrato, áudio e vídeo viram apoio. Dúvidas de leitura reconhecidas: valor por extenso, dígito confundido pelo OCR, conta cortada em duas linhas e nome contido no outro. Corrigidos o título com letras espaçadas grudado na razão social e a cláusula aceita como endereço.
- **Conferência (`kedu-conferencia-documental` v1.10.0)**: correção manual igual ao GLPI resolve o campo; divergência aceita com justificativa (qualquer perfil de edição ou Jurídico), válida só enquanto documento e GLPI não mudarem; tabela Contrato × GLPI em toda demanda.
- **Operação**: OCR do GitHub de hora em hora (07h40–19h40); contar áreas só com chamados abertos no GLPI; relatórios por período a partir das versões dos chamados e da auditoria; etiqueta de versão das regras em `fingerprint()` a cada mudança de regra.

## Atualização 1.7.0 / 1.8.0 / 1.9.0 (18/11/2026)

- **Organização da demanda (`kedu-triagem-documental` v1.7.0, `kedu-leitura-precisa` v1.8.0)**: CNPJ do formulário GLPI corrigido só quando o dígito verificador comprova (campo numérico `…,00`, zero inicial perdido) e CPF de pessoa física aceito. Vários CNPJs no campo são desempatados apenas por um único identificador presente nos documentos lidos. Demandas ainda não confirmadas são vinculadas a cada sincronização, com auditoria. No piloto, 18 das 24 demandas sem organização passaram a ser identificadas; as 6 restantes têm CNPJ com erro de digitação ou ambiguidade real.
- **Leitura de Word recebido (`kedu-leitura-precisa` v1.8.0)**: fontes e imagens incorporadas não contam no limite de texto; imagens ocultas sem texto não bloqueiam.
- **Comprovante bancário (`kedu-conferencia-documental` v1.9.0)**: dados bancários divergentes do GLPI levam a **Aguardando correção**.
- **Consulta ao GLPI incompleta**: causada pelo perfil do token sem direito a aprovações (`403 ERROR_RIGHT_MISSING`); resolve no GLPI.

## Atualização 1.7.0 / 1.8.0 (11/11/2026)

- **Triagem estrita entre `Contrato não encontrado`, `Tipo a confirmar`, `Contrato não lido` e `Contrato com pendências` (`kedu-triagem-documental` v1.6.0 & `kedu-leitura-precisa` v1.7.0)**:
  - Reconhecimento de contratos com nome prefixado (`Colégio X - 1º Termo Aditivo.pdf`, `Minuta - Contrato...`, `Assinatura_Contrato...`), títulos `Aditamento`, `Rescisão Contratual` e `Confissão e Parcelamento de Dívida` (`shared/document-heading.ts`), e preservação da classificação contratual via `isFilledContract(text, name)` mesmo quando o cabeçalho da página 1 é gráfico.
  - Disparo automático de leitura integral em PDFs de nome genérico quando a página 1 contém termos contratuais ou de envelope de assinatura digital (`likelyContractOnCover`: `Clicksign`, `DocuSign`, `ZapSign`, `D4Sign`, `Autentique`, `Contratante`, `Cláusula`), mantendo `needsWork: true` enquanto o contrato estiver em `triageOnly` ou `incomplete`.
  - Classificação de anexos `.pdf`, `.docx`, `.doc` e `.odt` já lidos integralmente sem estrutura contratual (ou identificados por `isSupportDocument`: boleto, estatuto, ata, certidão, alvará, ficha cadastral, DANFE/NF-e, declaração, ofício, requerimento) como `support`, deslocando demandas sem contrato de **Tipo a confirmar** ou **Conferência parcial** para **Contrato não encontrado** (`contractMissing`).
  - Registro explícito do motivo em **Contrato não lido** (`unreadableContractIssue`: fila automática pausada em chamado encerrado no GLPI, falha HTTP no download, aguardando vez na fila, leitura parcial `X/Y páginas lidas` com aviso do OCR, ou imagem sem contraste) e nos alertas de **Leitura parcial** (`review:partial:<nome> (X/Y páginas lidas — <motivo>)`).
- **Redução de falsos positivos em `Conferência parcial` (`kedu-conferencia-documental` v1.8.0 & `kedu-leitura-precisa` v1.7.0)**:
  - Expansão da confirmação guiada por rótulo contextual (`server/guided-confirmation.ts`) para `representanteNome`, `agencia`, `conta`, `remuneracao`, `repasse`, `garantia`, `inicio` e `fim` (incluindo datas por extenso em português e exclusão de `payerContext` em comprovantes bancários).
  - Validação automática por consenso duplo `Tesseract` + `PaddleOCR` (`server/verified-field-evidence.ts`) em PDFs digitalizados multipágina quando a página de origem (`origin.page` em `fieldOrigins`) está registrada e não há conflito entre páginas.
  - Desambiguação das expectativas do chamado GLPI (`server/request-expectations.ts`): filtragem do CNPJ/razão social da própria Kedu (`ownIdentity`) quando listado junto ao da escola, e resolução de transição explícita de taxa (`"de X% para Y%"` / `"taxa atual: X% ... nova taxa: Y%"`) para a nova taxa.
  - Expansão de `notApplicableReason` (`server/comparison-profile.ts`) para `nomeFantasia` ausente em contratos integralmente lidos sem cláusula de nome fantasia e para campos bancários ausentes em instrumentos de `Aditivo` (sem subtipo bancário), `Distrato`, `Rescisão` ou `Parcelamento`.

## Atualização 1.6.0

- O CNPJ da contratada recebe **Confere** quando os 14 dígitos coincidem e o documento comprova a associação à parte. A checagem cadastral é separada.

## Atualização 1.5.0

- Separar correção de referência no GLPI de erro no documento. Registrar as origens das taxas conflitantes e a evidência do valor lido.
- Preservar identificadores lidos com dígitos inválidos, conferir cartões de CNPJ com pontuação alterada pelo OCR e aceitar um zero inicial perdido pela formatação decimal do GLPI quando a planilha de descredenciamento comprovar o número válido.
- Priorizar demandas com poucas pendências e distinguir alteração simulada de etapa confirmada no painel.

## Atualização 1.4.0 (09/11/2026)

- **Escopo estrito do que é necessário ler (`kedu-leitura-precisa`)**: filtro prévio por papel do anexo (`attachmentRole` / `fieldsForRole`: `registration`, `bank`, `report`, `counterproposal`, `simulation`, `document`), matriz de campos exigidos por tipo/subtipo de demanda (`officialRequired`, `Descredenciamento`, `Pais x Escola` com `clausulaCessao`, modelos em branco `{{...}}`) e releitura direcionada (`targetedReadingTargets` e `Docling — estrutura do PDF`) apenas para campos `missing`/`review` pertinentes.
- **Descarte de falsos bloqueios na fila (`kedu-triagem-documental`)**: dispensa de revisão de anexo de apoio (`registration`, `bank`, `XLSX`) quando todos os seus campos já estão corroborados na camada digital de um instrumento contratual (`document`), dispensa de `CNH`/`RG` quando representante não foi solicitado (`unusedPersonalId`), exclusão de logos pequenos sem texto (`logoImage`) e detecção imediata de `contractMissing`.
- **Regras de revisão e evidência de OCR (`kedu-conferencia-documental`)**: distinção entre divergência real e revisão de nome/referência (`legalFormReferenceNeedsReview`, `referenceTradeNameNeedsReview`, `qualifiedNameNeedsReview`, `headerTradeName`), composição de endereço restrita ao mesmo documento (`withDocumentAddress`), critérios de validação automática de OCR (`verifiedFieldEvidence` com `Tesseract` + `PaddleOCR` e `identityEvidence`) e atualização de `esquema-relatorio.json` com `docling_estrutura_pdf` e `papel_anexo`.

## Atualização 1.3.0

- Identificar cada parte no preâmbulo de contratos e aditivos, com razão social, CNPJ e papel associados.
- Reconhecer a identificação da escola na aba de resumo de planilhas de descredenciamento e conferir o CNPJ quando o GLPI o exibir como inteiro com formatação decimal.
- Diagnosticar separadamente falha de leitura, associação ao campo e formatação da referência antes de reprocessar o arquivo.

## Atualização 1.2.0 (09/11/2026)

- Conferência automática de valores equivalentes quando a extração está associada ao campo correto e a referência é válida. A etapa oficial usa o mesmo resultado da comparação.
- Separação entre **Aguardando análise** (sem leitura aproveitável), **Conferência parcial** (leitura com pendências), **Aguardando correção** (divergência comprovada) e **Sem erros** (conferência resolvida). Medir separadamente a fila de arquivos e as transições de demanda.

## Atualização 1.1.0 (09/11/2026)

As três skills foram revisadas com o que mudou no sistema e o que as medições de 05 a 09/11 mostraram:

- Triagem: anexos da conversa e cobertura do GLPI; encerrados fora da leitura automática; novas causas (`nao_importado`, `versao_substituida`, `sem_conteudo`, `valor_sem_associacao`, `cobertura_parcial`); comportamento da fila; medição somente leitura e simulação em cópia do banco.
- Conferência: referência do formulário e da conversa, com correção explícita valendo; correspondência entre estados do sistema e classificações; decisões humanas registradas; lista de erros para tipos sem modelo.
- Leitura: estouro de tempo não é arquivo em branco; imagem sem contraste não é falha; ZIP sem leitor; limites atuais do motor; OCR local para conferir anexos (LGPD).

Somente as cópias deste projeto foram atualizadas. As cópias instaladas no perfil Hermes não foram alteradas: sincronize-as se quiser o mesmo comportamento no Hermes.

## Validação do pacote

Verificar frontmatter, referências locais, schemas MCP usados e equivalência entre cópias do perfil e do projeto. Validar o JSON Schema com casos fictícios de teste identificados como tais: aprovação com lacuna deve falhar; correção sem divergência comprovada deve falhar; campo confirmado sem trecho/localizador deve falhar.

Uma consulta de diagnóstico ao SQLite local via WSL foi tentada durante a criação e retornou `sqlite3.OperationalError: disk I/O error`. Não foram obtidas contagens atuais da fila, não foi feita releitura de anexos e não houve escrita no banco. Não usar `immutable=1` nem cópia simples de um banco ativo com WAL para contornar esse bloqueio: isso pode omitir transações. Repetir por ferramenta configurada no ambiente Windows ou snapshot consistente aprovado antes de medir a fila real.
