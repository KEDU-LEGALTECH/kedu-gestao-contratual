---
name: kedu-triagem-documental
description: Use na fila Kedu. Priorize pendências com evidência.
version: 1.9.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [kedu, glpi, documentos, triagem]
    related_skills: [kedu-leitura-precisa, kedu-conferencia-documental]
---

# Triagem documental Kedu

## When to Use — Quando usar

Para organizar a fila de arquivos e demandas em Aguardando análise, Conferência parcial ou Aguardando correção do projeto `C:\Users\Raissa Reis\Documents\kedu_sistema` (WSL: `/mnt/c/Users/Raissa Reis/Documents/kedu_sistema`). Fora desse projeto, não aplicar regras Kedu. O exemplo Bernoli inspira evidências e validação, não regras processuais.

## Procedimento

1. Ler `references/protocolo-fila.md`. Confirmar pasta, fonte de dados, escopo e data real. A criação/carregamento da skill não autoriza executar lote, reativar fila, baixar anexos ou alterar demandas.
2. Para diagnóstico, confirmar os filtros no schema do MCP instalado. Quando `list_pending_demands` estiver disponível para o status, paginar pelo total `counts.pending_demands`. Se o MCP só aceitar Aguardando análise e Aguardando correção, inventariar **Conferência parcial** com a consulta local somente leitura descrita no protocolo. Não relabelar a coorte para caber no filtro nem executar scripts que inicializam/migram o banco para diagnosticar.
3. Fixar coorte com IDs de demanda, GLPI, documentos, versão/hash do chamado e data. Separar etapa operacional `demands.stage`, status de processamento `contract_processing.status` e status original GLPI. O campo `stage` retornado por esse MCP representa o status de processamento, não a etapa operacional. Excluir Concluído, Cancelado e Em assinatura da recuperação, mesmo que apareçam na listagem MCP. Chamados solucionados (5) ou fechados (6) no GLPI saem da leitura automática (releitura só manual) e aparecem à parte na tela e nos relatórios: medir ativos e encerrados separadamente.
4. Inventariar anexos atuais e cópias anteriores sem sobrescrever. A lista do chamado inclui anexos da conversa (acompanhamentos, soluções, tarefas e aprovações), com origem em `documentLinks` e cobertura em `timelineCoverage`/`approvalCoverage`. Aprovação negada (HTTP 403) é cobertura parcial, nunca prova de arquivo não enviado. Nome igual não prova bytes iguais; hash de conteúdo igual permite evitar extração repetida, mas não dispensa associação/validação por demanda e versão. Versão substituída (mesmo nome e extensão, com "Revisado", "v2" etc. na mais nova; `server/document-versions.ts`) fica visível, mas fora da comparação. Não excluir arquivos, nem retirar pendências só para reduzir o contador.
5. Classificar causa: `nao_importado` (existe no GLPI, sem registro no projeto), `nao_baixado`, `versao_desatualizada`, `versao_substituida`, `falha_leitura`, `leitura_parcial`, `sem_conteudo` (imagem em branco ou sem contraste), `contrato_ausente` (`contractMissing`), `contrato_nao_lido` (`unreadableContract`), `campo_nao_localizado`, `valor_sem_associacao`, `associacao_ambigua`, `referencia_glpi_ambigua`, `cobertura_parcial`, `dado_nao_informado`, `formato_nao_suportado`, `limite_recurso` ou `divergencia_comprovada`. São categorias do relatório, não novos estados do banco. Permitir mais de uma causa por arquivo e avisar que totais de causas podem se sobrepor. "Arquivo não enviado" só com todas as origens consultadas.
6. Descartar falsos bloqueios de leitura e separar corretamente as áreas sem conferência: **Aguardando elaboração do contrato**, **Contrato não encontrado**, **Consulta ao GLPI incompleta** e **Contrato não lido** (`server/contract-processing.ts`, `server/contract-reading-scope.ts`, `shared/document-heading.ts`). **Não existe área "Tipo a confirmar"** (regra da usuária, 23/11/2026): toda demanda vai para uma área real e a mensagem cita pelo nome os anexos ainda não identificados.
   - **Aguardando elaboração do contrato** (`missingReason: awaiting_drafting`): chamado sem nenhum contrato preenchido — só documentos de apoio, propostas, relatórios ou modelos em branco (`{{...}}`). É o caso normal de pedido de contrato novo, aditivo, parcelamento e descredenciamento: a Kedu ainda vai elaborar o instrumento. Vale mesmo com aprovações do GLPI ilegíveis (a mensagem avisa). Quando um contrato preenchido for anexado, a conferência acontece sozinha.
   - **Contrato não encontrado** e **Consulta ao GLPI incompleta** ficam só para pedidos de **análise contratual**, que deveriam trazer o contrato.
   - **Identificação inconclusiva**: arquivo que passou só pela identificação inicial (`triageOnly`), com ou sem texto, recebe leitura completa (nunca uma nova identificação, para não entrar em ciclo). Foto lida por completo, com confiança e sem estrutura de contrato vira `support`; leitura duvidosa continua pendente, porque pode ser página de contrato mal fotografada. Áudio e vídeo (`.ogg`, `.opus`, `.mp3`, `.mp4`…) são `support`.
   - **Corroboração por documento digital**: se um anexo de apoio (`registration`, `bank` ou `XLSX`) teve OCR com baixa confiança, mas todos os campos permitidos para o seu papel já constam com o mesmo valor na camada digital de um contrato/instrumento (`document`) sem problemas, a revisão do anexo de apoio é dispensada.
   - **Documento de identidade pessoal não utilizado (`unusedPersonalId`)**: `CNH` ou `RG` integralmente lido sem campos contratuais não bloqueia a demanda quando `representanteNome` e `representanteCpf` não foram solicitados e os demais campos pedidos já conferem.
   - **Logos e assinaturas pequenos (`logoImage`)**: imagem menor que 80 KB sem texto legível não é tratada como documento ilegível quando outro anexo da demanda traz o conteúdo válido.
   - **Confirmar se em `Contrato não encontrado` (`contractMissing`) realmente não há contrato**: verificar se um contrato legítimo deixou de ser reconhecido por ter nome prefixado (ex.: `Colégio X - 1º Termo Aditivo.pdf`, `Minuta - Contrato...`, `Assinatura_Contrato...`), título `Aditamento` / `Rescisão Contratual` / `Confissão e Parcelamento de Dívida`, ou nome genérico com capa de assinatura digital (`Clicksign`, `DocuSign`, `ZapSign`, `D4Sign`, `Autentique`, `Contratante`, `Cláusula` — `likelyContractOnCover`). Quando a página 1 contiver esses indicadores, o PDF sai de `triageOnly` e passa por leitura integral.
   - **Anexos de apoio**: `.pdf`, `.docx`, `.doc` ou `.odt` já lidos integralmente sem cláusulas/estrutura contratual ou reconhecidos por `isSupportDocument` (boleto, estatuto, ata, certidão, alvará, ficha cadastral, DANFE/NF-e, declaração, ofício, requerimento, histórico, "ANEXO I – Demonstrativo" de antecipação) são `support`. Quando todos os anexos são `support` e não há contrato, a demanda vai para **Aguardando elaboração do contrato** (ou **Contrato não encontrado**, se for análise contratual). Inversamente, `isFilledContract(text, name)` preserva como contrato arquivos nomeados `Contrato.docx`/`Aditivo.pdf` cujo cabeçalho era apenas gráfico. "Termo Anexo" no nome não prova contrato: na Kedu costuma ser o demonstrativo financeiro.
   - **Garantir leitura de `Contrato não lido` (`unreadableContract`) e informar o motivo exato**: todo `contractCandidateFile` sem leitura completa (`!reading.complete` ou `reading.triageOnly`) permanece elegível na fila (`needsWork: true`). Enquanto não estiver lido, `unreadableContractIssue` registra a causa exata: aguardando download na fila automática (ou fila automática pausada por chamado encerrado no GLPI, exigindo clicar em **Analisar anexos**), falha HTTP no download do GLPI, arquivo na fila de leitura, leitura parcial `(X/Y páginas lidas — motivo do OCR)`, imagem sem contraste (`empty_source`) ou falha técnica (`read_failed`). Em `Conferência parcial`, anexos parciais informam `review:partial:<nome> (X/Y páginas lidas — <motivo>)`.
7. Priorizar por prazo e prioridade, depois pela chance de resolver a demanda. Em Conferência parcial, atacar primeiro os casos com um ou dois campos pendentes e reler só a página, região ou célula pertinente (`targetedReadingTargets` em `server/targeted-reading.ts`). Em Aguardando análise, verificar acesso e fila do primeiro anexo aproveitável. Em Aguardando correção, confirmar a fonte e informar a alteração necessária. Preservar leituras úteis e evitar OCR quando a fonte estiver ausente ou quando a pendência for estrutural (`counterproposal`, `simulation`, fórmulas em planilha ou ambiguidade de partes).
8. Para leitura auxiliar chamar `kedu-leitura-precisa`. Para comparação chamar `kedu-conferencia-documental`. Trabalhar serialmente em lotes pequenos, preservando progresso em relatório local solicitado. Usar anexos e IDs reais, nunca selecionar somente pelo nome da organização.
9. Entregar contagens separadas de demandas, anexos únicos por demanda/versão, páginas examinadas e campos. Distinguir diagnóstico, leitura auxiliar, proposta de correção e atualização efetivamente gravada. Redução de fila só existe se verificada no fluxo oficial sobre a mesma coorte.

## Diagnosticar um campo ausente na tabela

Se a conversa estiver visível sem o contrato, compare o inventário com as origens do GLPI, incluindo pedidos de aprovação (`TicketValidation`). Um 403 deixa a cobertura parcial. Horário e autor no log servem para localizar candidatos. Antes de importar ou baixar, valide o vínculo da aprovação com o ID do chamado e o vínculo do anexo com a aprovação. Registre separadamente anexos já armazenados e vínculos que o perfil consegue comprovar na consulta atual.

Se o anexo estiver disponível e o dado aparecer no texto armazenado, verifique se o valor foi associado à parte (`scopePartyReading`), ao rótulo contextual (`guidedConfirmation` em `server/guided-confirmation.ts`), ao papel do anexo (`fieldsForRole`), à aba ou ao campo correto antes de reler o arquivo. Confira a referência GLPI separadamente (`server/request-expectations.ts`: filtragem de `ownIdentity` da própria Kedu e resolução de transição explícita de taxa `"de X% para Y%"`). Um identificador formatado como número decimal pode causar pendência de referência mesmo com a leitura do documento disponível. Quando a falha for de associação ou comparação, recalcule a partir da extração existente pelo fluxo autorizado e compare campo e etapa antes e depois.

Compare, na mesma coorte, as pendências em que o valor coincide, as de associação incerta, as de referência contraditória e as de validação de identificador. Uma ou duas pendências ajudam a priorizar a auditoria. A etapa depende da causa e da evidência. Registre separadamente resultados simulados e resultados confirmados no painel após o recálculo oficial.

## Demanda sem organização

A organização da demanda vem do campo CNPJ do formulário GLPI (`server/reference-document.ts`). Antes de pedir vínculo manual, classifique a causa:

- **Campo numérico do GLPI**: `34.347.853.000.116,00` ou `19.568.999.000.10600` (formulário de descredenciamento). O portal remove `,00` e os separadores e aceita só se o dígito verificador comprovar o CNPJ.
- **Zero inicial perdido**: `3869258000117`. Completado com zeros só quando o dígito verificador comprova.
- **CPF** (pessoa física, como palestrante ou DJ): aceito quando o CPF é válido.
- **Vários CNPJs no campo** (mantenedora e escola, ou duas unidades): o portal nunca escolhe sozinho. Desempata só quando exatamente um deles aparece nos documentos lidos da demanda (`server/organization-evidence.ts`), com o nome da parte qualificada no contrato.
- **Dígito verificador errado ou dígitos faltando sem documento que comprove**: fica para o recebimento. Não corrigir por semelhança.

O vínculo automático (`linkPendingOrganizations`, a cada sincronização e no botão "Atualizar organizações dos chamados") só vale enquanto o recebimento não foi confirmado e fica na auditoria. A pessoa ainda confirma a organização no recebimento.

## Interpretar a fila

- Após aplicar uma correção autorizada, verifique que `/healthz` responde e que `X-Kedu-Build` corresponde à versão aplicada. Depois confira o recálculo no fluxo oficial. Compare os mesmos chamados com o mesmo hash e examine separadamente a versão atual dos que mudaram no GLPI. Uma atualização pode deixar o contrato pendente de obtenção ou leitura, mesmo que a versão anterior tenha passado na simulação.

- **Consulta ao GLPI incompleta** com linha do tempo completa e `approvalCoverage: partial` é falta do direito de aprovações (`ticketvalidation`) no perfil do token: o GLPI responde `403 ERROR_RIGHT_MISSING`. Não é falha de leitura; resolve com permissão no GLPI (usuário de integração pedido ao administrador), não com nova tentativa.
- **Aguardando leitura com OCR** (publicação na Vercel): imagem ou digitalização que espera o leitor PaddleOCR do GitHub Actions, de hora em hora, das 07h40 às 19h40 de Brasília. O GitHub atrasa ou descarta alguns agendamentos; o horário seguinte compensa. Não é falha e não consome tentativas.
- **Contar áreas só com chamados abertos no GLPI** (status diferente de 5 e 6). Solucionados e fechados têm leitura pausada de propósito e aparecem como "Chamado solucionado/finalizado"; somá-los infla "Contrato não lido". Medir produção direto no Supabase (`KEDU_DATABASE=postgres`, esquema `kedu_migration`): o `.env` local aponta para o SQLite antigo.
- **Relatórios por período** (`server/period-report.ts`): movimentos do GLPI vêm de `glpi_ticket_versions` (desde 20/10/2026); mudanças de área na conferência vêm da auditoria (`Conferência: <antes> → <depois>`), registradas a partir de 23/11/2026.
- **Aguardando a vez na fila** indica que a tentativa de um arquivo ainda vai começar. **Nova tentativa programada** tem horário próprio. **Em leitura** indica obtenção ou leitura em andamento. **Ainda não há tentativa automática agendada** é um estado separado.
- **Leitura concluída** descreve o arquivo. Para classificar a demanda, conferir os campos e demais bloqueios com `kedu-conferencia-documental`. Um arquivo na fila pode coexistir com outro já lido.

## Medir a qualidade da leitura

Para decidir a próxima melhoria com números, só leitura e direto no Supabase:

1. Coorte: demandas com chamado aberto no GLPI (status diferente de 5 e 6) e pelo menos uma comparação, ignorando `not_applicable`.
2. Contar os campos por situação (`matches`, `missing`, `review`, `different`, `ambiguous`), por campo e pelo motivo (`reviewReason.code`, `missingReason`).
3. Para cada `missing`, procurar o valor do GLPI no texto dos contratos comparados (dígitos para CNPJ/CEP; texto sem acento e pontuação para nomes). Valor no texto = falha de associação (redação não reconhecida, parte errada, documento errado). Fora do texto = ausência real ou leitura parcial.
4. Antes de publicar uma correção, simular com `buildProcessingPlan` sobre os mesmos dados e comparar antes × depois campo a campo; divergência nova que aparece porque o campo passou a ser lido é achado real, não regressão.

Linha de base em 23/11/2026 (66 demandas, ~210 campos): conferidos sozinhos 70% → 78% depois das correções de redação; não localizados 15% → 7%. Os restantes são majoritariamente dados ausentes do próprio contrato.

## Armadilhas

- As ferramentas MCP atuais não baixam originais do GLPI nem escrevem o resultado oficial. Leitura auxiliar não muda status na aplicação.
- `list_pending_demands.offset` pagina demandas; `read_pending_batch.attachment_offset` pagina anexos. Não intercambiar.
- A paginação da fila viva não é um snapshot: mudanças de status podem saltar itens. Fixar IDs e repetir inventário para detectar entradas/saídas.
- Não copiar .env, banco, documentos ou dados pessoais para provedores externos. Não alterar outro perfil Hermes.
- Não executar `--apply`, SQL de escrita, limpeza, aprovação em lote ou retomada de tarefas sem escopo autorizado e backup consistente.
- Fila (`reading_jobs`): uma demanda por vez. Falta de memória (leitor adia abaixo de 512 MB livres) ou leitor indisponível não consome tentativas; falha do arquivo esgota após 3, e esgotadas reabrem uma vez por dia; `done` com arquivo ainda pendente reabre. Suspensão do computador ou queda da rede para fila e sincronização: confira eventos de energia antes de atribuir a falha ao código.
- Editar `server/` ou `shared/` com a API em modo watch reinicia o servidor, gera backup de cerca de 500 MB e interrompe a leitura em andamento. Implementar em worktree e aplicar tudo de uma vez, entre uma demanda e outra.
- Mudança de regra de comparação: bumpar o fingerprint em `server/contract-processing.ts` e simular antes em cópia do banco (ver protocolo).

## Verificação

- Reconciliar IDs e totais por ferramenta/código, sem soma mental.
- Cada causa tem documento/versão e evidência ou erro observável; ausência de acesso não é ausência de dado.
- Relatar casos sem anexo, excluídos por etapa, duplicados e arquivos não suportados.
- Não prometer redução, acurácia ou leitura integral sem medição. Informar o bloqueio e a próxima ação verificável.
- Comandos de apoio, somente leitura: `npm run glpi:check` (a máquina alcança o GLPI?), `npm run db:verify-backup` (backup restaurável?) e `npm run production:check` (pendências de implantação). Linha de base da auditoria: `docs/auditoria-anexos-glpi-2026-11-05.md`.
