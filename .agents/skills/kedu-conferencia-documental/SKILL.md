---
name: kedu-conferencia-documental
description: Use na conferência Kedu. Compare sem aprovar lacunas.
version: 1.9.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [kedu, glpi, conferencia, qualidade, evidencias]
    related_skills: [kedu-triagem-documental, kedu-leitura-precisa]
---

# Conferência documental Kedu

## When to Use — Quando usar

Após extrair campos de anexos Kedu, para comparar com a solicitação GLPI e distinguir erro de preenchimento, erro de leitura, revisão de referência/associação e falta de fonte. Para aprovação jurídica, seguir os responsáveis e controles do projeto; esta skill não os substitui.

## Procedimento

1. Fixar demanda, versão atual do chamado, documento e origem dos valores solicitados. A referência vem do formulário e de toda a conversa pública do chamado, em ordem de data (`conversationReferences`); mensagens privadas não contam. Uma mensagem posterior que corrige explicitamente o dado ("correção", "o correto é", "retificando") passa a valer e o valor anterior fica registrado; sem essa indicação, valores diferentes ficam juntos como referência ambígua. Aplicar as regras de desambiguação da referência do GLPI (`server/request-expectations.ts`):
   - **Filtragem de identidade própria da Kedu (`ownIdentity`)**: quando o chamado lista o CNPJ (`45.543.580/...`) ou a razão social da própria Kedu (`Kedu Serviços e Soluções Educacionais`) junto ao CNPJ/razão social da escola, `ownIdentity` filtra a Kedu para que a referência da contratada permaneça única e sem falso `ambiguous`.
   - **Transição explícita de taxa (`rateTransitionExpectation`)**: quando o texto do chamado descreve alteração de taxa (`"de X% para Y%"`, `"taxa atual: X% ... nova taxa: Y%"`), a referência esperada resolve univocamente para a nova taxa (`Y%`).
   - Fora desses casos, várias empresas sem vínculo ou instruções conflitantes exigem esclarecimento da referência. Aplicar a regra de comparação literal de CNPJ do passo 2 quando a parte estiver comprovada.
2. Marcar **Confere** automaticamente quando o valor extraído do documento e o valor solicitado no GLPI forem iguais após a normalização do campo, com referência inequívoca e associação ao campo, à parte e ao papel do anexo corretos (`fieldsForRole`). O resultado oficial é `matches` sem `readingPending`.
   - Quando a referência é única e o extrator estruturado não associou o campo diretamente, `guidedConfirmation` (`server/guided-confirmation.ts`) pode confirmar o valor a partir do texto do anexo compatível (`fieldsForRole`) somente quando precedido por rótulo contextual explícito da parte correta (excluindo contexto de pagador `payerContext` em dados bancários), cobrindo: `cnpj`, `razaoSocial`, `nomeFantasia`, `endereco`, `rua`, `numero`, `bairro`, `cidade`, `estado`, `cep`, `banco`, `agencia`, `conta`, `titularConta`, `documentoTitular`, `pix`, `representanteNome`, `representanteCpf`, `remuneracao`, `repasse`, `garantia`, `inicio` e `fim` (incluindo datas por extenso em português).
   - Em extrações de OCR (`server/reading-policy.ts`), a confirmação automática exige:
     - Concordância da camada digital (`hasDigitalField`) ou evidência visual assistida (`assistedVisualField`), ou
     - `verifiedFieldEvidence` (`server/verified-field-evidence.ts`: rótulo explícito no trecho e confiança $\ge 85$, ou concordância unívoca e sem conflito entre os passos `Tesseract` e `PaddleOCR` — válida inclusive em PDFs multipágina quando `origin.page` está registrado em `fieldOrigins`), ou
     - `identityEvidence` (`server/identity-evidence.ts`: dígito verificador válido e vínculo explícito ao papel para `cnpj`, `representanteCpf` ou `documentoTitular`) quando o valor coincide com a referência única do GLPI.
   Se o valor só apareceu em texto sem associação, pertence a outra parte, veio de papel de anexo incompatível, foi copiado do GLPI ou a referência é ambígua, manter a pendência correspondente. A comparação do CNPJ da contratada usa os 14 dígitos completos de uma fonte com associação comprovada à parte. Nessa comparação, a falha dos dígitos verificadores não impede **Confere**. Validação cadastral e emissão seguem seus controles próprios. `same_after_basic_normalization` do MCP ajuda a comparar os valores. O status oficial vem do processamento Kedu.
3. Preservar os valores literais. Aplicar normalização somente à cópia de comparação, por campo: caixa/acentos/espaços/pontuação sem apagar palavras distintivas; máscaras de CPF/CNPJ mantendo todos os dígitos; valores e percentuais com unidade e separador inequívocos. `endereco` pode ser composto por `rua, numero` apenas quando ambos forem extraídos univocamente do mesmo documento (`withDocumentAddress` em `server/comparison-evidence.ts`), nunca misturando partes do GLPI com o anexo.
4. Validar CPF/CNPJ e aritmética com ferramenta. Fora da comparação de CNPJ coincidente com parte comprovada, número inválido permanece literalmente como fornecido com achado (`invalid_identifier`); não reparar dígito ou completar zeros. Aplicar as regras de revisão de razão social e nome empresarial (`server/comparison-evidence.ts`), classificando como revisão (`inconclusivo`/`referencia_pendente`) e nunca como erro direto do documento ou aprovação silenciosa:
   - `legalFormReferenceNeedsReview` (`reference_name_typo`): diferença de 1 caractere apenas na sigla da natureza jurídica (`LTDA`, `EIRELI`, `EPP`, `ME`, `MEI`) na referência do GLPI.
   - `referenceTradeNameNeedsReview` (`reference_trade_name`): CNPJ confere, mas o GLPI informou o `nomeFantasia` do documento no campo de `razaoSocial`.
   - `qualifiedNameNeedsReview` (`qualified_name`): um dos lados traz mantenedora/qualificador entre parênteses (`Nome (Mantenedora)`) e o outro traz apenas o nome curto.
   - `headerTradeName`: cabeçalho `NOME (CNPJ)` sem natureza jurídica em proposta ou resumo de relatório identifica nome comercial e não comprova divergência de razão social.
5. Classificar cada campo: `confere` (valor explícito e associado, referência inequívoca e equivalência comprovada); `divergencia_comprovada` (valor legível incompatível após normalização segura); `nao_localizado` (não apareceu nas fontes examinadas); `inconclusivo` (leitura/associação/cobertura insuficiente ou revisão de nome comercial/qualificador); `referencia_pendente`; `nao_se_aplica` (justificativa explícita de `notApplicableReason` em `server/comparison-profile.ts`: campos fora de `razaoSocial`/`cnpj` em descredenciamento; dados cadastrais da escola em contrato `Pais x Escola`; documentos compostos apenas por modelos `{{...}}`; `nomeFantasia` ausente em contratos integralmente lidos sem cláusula de nome fantasia; e campos bancários `banco`/`agencia`/`conta`/`titularConta`/`documentoTitular`/`pix` ausentes em instrumentos de `Aditivo` sem subtipo bancário, `Distrato`, `Rescisão` ou `Parcelamento`). Em contratos educacionais `Pais x Escola`, incluir a conferência de `clausulaCessao` (`cessionClauseCheck`: `matches` se cita Kedu, `review` se cessão genérica a terceiros, `different` se leitura digital completa sem cláusula, `missing` se leitura incompleta/OCR). Correspondência com o sistema: `different` = divergência; `ambiguous` = referência pendente; `missing` com `value_unassociated` (valor aparece no texto sem rótulo/entidade), `not_located`, `partial`, `coverage_partial`, `download_pending` (ainda não importado) ou `source_unidentified` = inconclusivo ou não localizado, nunca confere; `not_sent` só com cobertura completa; `empty_source`/`not_printed` = dado ausente na fonte.
6. Distinguir erro do documento de erro na transcrição/OCR. No primeiro, propor correção do preenchimento; no segundo, propor corrigir leitura com prova do original. Não usar uma correção de valor contratual para esconder erro do leitor.
7. Propor a etapa pelo resultado agregado, nesta ordem:
   - **Aguardando correção** se houver uma divergência comprovada ou um conflito comprovado de taxas na referência do GLPI (`reference_conflict`), mesmo com outros campos pendentes. Identifique se a ação é corrigir o documento ou definir a referência no chamado. No segundo caso, registre as taxas e a origem de cada uma, bem como o valor comprovado no anexo.
   - **Aguardando análise** quando nenhum anexo vigente tem leitura aproveitável e não há divergência comprovada. Informar se falta baixar, ler, repetir ou obter um anexo.
   - **Conferência parcial** quando existe leitura aproveitável e ainda resta campo aplicável não confirmado, referência pendente ou bloqueio de leitura necessário.
   - **Sem erros** quando os campos solicitados e aplicáveis conferem ou foram resolvidos pelo fluxo oficial, sem divergência ou bloqueio de leitura restante. Um conjunto vazio de comparações não basta.
   A fila de arquivos e os estados de encerramento do GLPI são separados da conferência. Tipos sem modelo oficial (contrato educacional, análise contratual, descredenciamento, distrato) entregam a lista de erros com campo, valor encontrado, valor esperado e origem. Contrato de garantia e aditivos também podem gerar contrato corrigido com modelo homologado. Download, aprovação jurídica e assinatura têm controles próprios.
8. Entregar relatório com rastreabilidade; usar `references/esquema-relatorio.json` se houver saída JSON. O esquema organiza o relatório, não é payload da API. Não inventar hashes, responsáveis, páginas ou datas faltantes.
9. Por padrão, não gravar na aplicação. Se houver solicitação explícita para aplicar, usar sessão autorizada e fluxo integrado, com backup consistente verificado antes da intervenção, versão/revision atual, escopo fixo e auditoria. Não editar tabelas para promover status, não desativar travas e não registrar conferência humana ou gabarito em nome do usuário com base em IA.
10. Após escrita autorizada, reler o alvo exato e conferir valores, versão, pendências e auditoria. Em conflito 409, interromper e recarregar antes de propor nova ação; não forçar sobrescrita. Preservar Concluído, Cancelado e Em assinatura. Reconciliar a coorte antes/depois com `kedu-triagem-documental`.

## Armadilhas

- Não localizado não é dado inexistente, não informado ou não se aplica. Dado não informado exige exame das fontes pertinentes completas e versão fixada.
- Duas fontes discordantes ou múltiplos candidatos exigem associação, não escolha do que coincide com a referência.
- Resultado sintético não mede documentos reais. Redução de fila não comprova precisão nem autorização jurídica.
- Rotas de confirmação e correção de transcrição em `server/processing-routes.ts` criam revisão e gabarito atribuído à sessão humana. Não chamá-las para disfarçar revisão assistida como humana; se não existir caminho compatível, entregar proposta e registrar o bloqueio.
- Até GET de processamento pode recalcular/persistir resultados no servidor (`processingView`). Para diagnóstico estritamente somente leitura usar MCP/SQLite read-only, não presumir que todo GET é sem efeito.
- Decisões humanas registradas (`POST /api/demands/:id/processing/resolutions`, tabela `processing_resolutions`): escolha da referência ambígua e aceite justificado de achado de validação. Exigem justificativa, ficam na auditoria e perdem efeito se o chamado ou o valor mudar. Mesma regra das confirmações: não chamar em nome do usuário.
- Comprovante bancário é documento de apoio, mas banco, agência, conta, titular, documento do titular e PIX impressos nele são comparados com o GLPI: divergência gera aviso que cita o arquivo e leva a demanda para **Aguardando correção** (regra de negócio de 18/11/2026). Sem valor de referência no GLPI não há comparação. Os demais documentos de apoio continuam fora da comparação.
- Arquivo lido por completo sem nenhum campo aproveitado não bloqueia quando todos os campos pedidos estão resolvidos por outra fonte; aparece como "Não utilizado". Isso não é aprovação do arquivo: se ele puder contradizer os demais, conferir o original.
- Confirmações humanas valem para os mesmos bytes e a mesma extração e acompanham novas versões do chamado; leitura nova do arquivo exige nova confirmação.

## Exemplos de conferência

- **Duas escolas no mesmo contrato.** Identifique primeiro a escola pedida pela razão social inequívoca na qualificação e compare o CNPJ desse bloco. Se o CNPJ do GLPI coincidir com o da outra escola, a coincidência pertence a outra entidade. Se o nome não distinguir as partes, use a identificação documental disponível ou mantenha a associação pendente. Quando a camada digital comprovar a escola e o campo e o valor coincidir, finalize automaticamente como **Confere**.

- **Conferência limitada ao contrato.** Compare os campos aplicáveis do instrumento vigente com a referência do GLPI. Documento de apoio pode orientar a busca e esclarecer o contexto. Um campo sem evidência no instrumento permanece pendente mesmo quando consta em cartão CNPJ ou comprovante. Use **Contrato não encontrado** quando a cobertura confirmar que só há apoio (inclusive `.pdf`/`.docx`/`.odt` lidos sem estrutura contratual) ou que nenhum instrumento foi enviado. Use **Contrato não lido** quando houver um candidato (`contractCandidateFile`) cuja obtenção ou leitura ainda esteja pendente, informando a causa exata (`unreadableContractIssue`).

- **Duas taxas no pedido e uma no anexo.** Se o texto do chamado trouxer transição explícita (`"de 14,90% para 4,50%"` ou `"taxa atual: 14,90% / nova taxa: 4,50%"`), `rateTransitionExpectation` adota a nova taxa (`4,50%`) como referência única. Sem indicação de transição, retificação explícita ou distinção de contexto, classifique `conflito_de_referencia_comprovado` e encaminhe para **Corrigir referência no GLPI**. A coincidência do anexo com uma das taxas não escolhe a taxa aplicável.
- **Mesmo CNPJ nos dois lados.** Se os 14 dígitos coincidirem e a fonte comprovar que pertencem à contratada identificada no GLPI, marque **Confere** e mostre o trecho de origem. A coincidência é um resultado documental. Para validação cadastral, consulte a fonte oficial e preserve o número literal.
- **Valor idêntico sem associação.** Confira rótulo, seção, entidade e papel da fonte. Uma menção ao nome da escola em e-mail ou ao CNPJ em outra parte do contrato não comprova o campo. Se a associação vier de um trecho inequívoco ou de OCR verificado, recalcule o campo pelo fluxo oficial.

- Conta extraída como `123456-7` e solicitada como `1234567`. Se ambas forem a conta da mesma parte, os dígitos conferem e o campo fica resolvido.
- Um nome empresarial só aparece no cabeçalho de um e-mail. Mesmo que o texto coincida com o GLPI, verificar se o cabeçalho comprova a razão social da parte pedida.
- Razão social e identificador conferem e são os únicos campos aplicáveis. Sem outro bloqueio de leitura, a etapa é **Sem erros**. Se um campo adicional ainda estiver ilegível, fica **Conferência parcial**. Se houver uma divergência comprovada, fica **Aguardando correção**.

- **Contrato com escola e fornecedora.** Compare o par razão social/CNPJ da escola identificado na qualificação. Quando os dois pares estão claros no preâmbulo, a presença do CNPJ da fornecedora não cria uma divergência ou confirmação pendente para a escola. Se os anexos realmente identificarem duas escolas ou filiais possíveis, mantenha a pendência de associação.
- **CNPJ do GLPI com aparência de valor decimal.** Preserve o texto original. Se o campo rotulado como CNPJ contiver um inteiro exibido com agrupamento brasileiro e terminar em `,00`, use a parte inteira para comparação apenas se ela já tiver 14 dígitos e dígitos verificadores válidos. Preserve zeros à esquerda. Excepcionalmente, se o GLPI exibir 13 dígitos com agrupamento brasileiro e `,00`, a planilha vigente de descredenciamento pode comprovar um único zero inicial: exija um CNPJ válido no resumo da escola, sem outro CNPJ concorrente na comparação, e igualdade dos outros 13 dígitos. Mostre o valor original e a normalização separadamente. Para 13 dígitos sem formatação decimal, centavos diferentes de zero, dígitos inválidos ou mais de uma interpretação, mantenha a referência pendente. Compare com o CNPJ associado à escola no anexo e cite sua origem. A normalização da referência não comprova a extração.

## Verificação

- Valor encontrado e esperado permanecem separados, com documento/versão/localizador e entidade.
- Todos os campos aplicáveis têm classificação e próxima ação; nenhum vazio é aprovação.
- A equivalência confirmada aparece como **Confere** na tabela e entra no cálculo da etapa da demanda. Verificar os dois pontos sem registrar confirmação humana fictícia.
- Gravações, se autorizadas, foram relidas. Sem escrita, declarar resultado proposto e fila inalterada por esta análise.
