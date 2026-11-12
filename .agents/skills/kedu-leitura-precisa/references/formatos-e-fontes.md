# Formatos e documentos de origem

## Escolha do leitor

Confirmar as capacidades na implementação disponível; não prometer suporte universal.

- PDF digital: ler camada de texto por página e verificar ordem de leitura/tabelas. PDF misto: manter páginas digitais e usar OCR nas imagens. PDF digitalizado: renderizar e conferir orientação, resolução e regiões. Camada vazia não prova documento vazio. Registrar páginas totais, concluídas e pendentes.
- Imagens PNG/JPG/JPEG/WebP/GIF/BMP/TIF/TIFF: orientação, rotação, quadros/páginas e recortes. A visão pode examinar só o primeiro quadro; não considerar TIFF/GIF inteiro sem verificar. Nunca recortar o original destrutivamente.
- DOCX: parágrafos e tabelas, marcadores, conteúdo de imagens, cabeçalho/rodapé e alterações controladas quando acessíveis. Texto extraído não fornece paginação Word estável; citar seção/tabela/parágrafo. Controles, objetos ou alterações rejeitados permanecem bloqueados, sem removê-los para conseguir aprovação.
- DOC: o leitor integrado da aplicação pode oferecer suporte, mas o MCP local atual não inclui .doc no SUPPORTED. Usar leitor autorizado existente ou conversão local em cópia, verificando a fidelidade; não renomear para .docx.
- XLSX: inventariar abas (inclusive ocultas), linhas/colunas, fórmulas e valores em cache. Citar aba e célula/faixa. Valor em cache pode estar desatualizado; não afirmar que executou cálculo. Fórmula, célula vazia, zero e texto são diferentes. Carregar microsoft-office/references/excel.md ao extrair diretamente por ferramentas Office.
- PPTX: slides, tabelas, imagens e notas relevantes; citar slide/objeto. Não chamar extração de XML de conferência visual de todas as imagens.
- ODT: texto e tabelas com seção/parágrafo; paginação pode não existir. Imagens embutidas precisam de inspeção específica.
- TXT/CSV: confirmar codificação, delimitador, cabeçalhos, aspas e linhas. Preservar zeros de identificadores e strings de datas. Não executar fórmulas ao exportar CSV. Citar linha/coluna ou registro.
- Extensão desconhecida, arquivo protegido, truncado ou acima do limite: explicar bloqueio e solicitar versão acessível; não fabricar extração.
- ZIP: sem leitor no motor integrado. Pedir os documentos separados; não repetir tentativa.
- Motor integrado (conferido em 09/11/2026): PDF lê toda a camada digital antes do OCR; página com pouco texto ou imagem cobrindo mais de 15% da área vai para OCR, com orçamento de cerca de 35 s por página (70 s em cartão CNPJ) e 140 s por arquivo; páginas não concluídas ficam listadas em `pendingPages`. OCR complementar de página que já tem texto digital pode ser pulado com aviso, sem marcar o arquivo como parcial. DOCX/XLSX/PPTX/ODT: imagens incorporadas grandes passam por OCR; as sem contraste são registradas como sem conteúdo.

Para extração direta de PDF/Office carregar a skill do formato e sua referência pertinente. No MCP atual o limite é 20 MB por arquivo, até seis páginas PDF por chamada e corte de texto de 60.000 caracteres. Esses limites não são os limites universais do motor integrado. Confirmar código/schema atual. Persistir progresso fora dos originais.

## Identidade por parte ou aba

- **Síntese com duas escolas.** Separe as qualificações numeradas mesmo quando aparecem no mesmo parágrafo, após uma data ou depois de um ponto final. Considere expressões intermediárias como “sociedade” e “mantenedora”. Vincule nome, CNPJ, endereço e conta ao bloco correspondente. Preserve a evidência digital dessa associação ao montar os campos da comparação.

- **PDF com texto em colunas.** Se a extração juntar o título do aditivo ou distrato à razão social, confirme a separação na página original. Remova apenas o prefixo identificado como título e preserve o nome legal completo. Restrinja a qualificação aos limites do bloco da parte antes das cláusulas.
- **CNPJ quebrado na linha.** Reúna os 14 dígitos somente quando a quebra ocorrer dentro do mesmo trecho de qualificação. Registre a página, o trecho literal e a parte. Números próximos de outra parte ou de uma nova cláusula exigem evidência própria.
- **Assinaturas lado a lado.** Uma assinatura rotulada pode comprovar a razão social daquela parte. Valide cada campo no bloco correspondente. Se a locadora estiver identificada na assinatura e o único CNPJ for o da locatária, confirme apenas o nome da locadora.

- **Contrato ou aditivo com várias partes.** Leia o preâmbulo mesmo quando não houver rótulos como “Contratante”. Use separadores como “de um lado”, “de outro lado” e os parágrafos de qualificação para vincular nome empresarial, CNPJ e papel. Se houver um complemento comercial depois de um travessão, separe-o da razão social somente quando a qualificação sustentar essa separação. Guarde o nome literal e o localizador. Fornecedor, anuente, representante e escola têm papéis distintos. Mantenha a pendência se o texto não vincular o identificador à parte solicitada.
- **Planilha de descredenciamento.** Comece pela aba de resumo e pelo cabeçalho de identificação. Uma célula pode conter só o CNPJ, sem rótulo, logo abaixo do nome da escola e do mês. Use a disposição das células e o contexto da aba para comprovar a associação. Registre as células de nome e CNPJ, inclusive quando houver mesclagem. Separe o CNPJ da operadora e os identificadores de outras abas, linhas de cobrança ou filiais. Leia os identificadores literais mesmo quando o relatório também contiver fórmulas financeiras. Restrinja a conferência aos campos aplicáveis ao pedido.

## Escopo por papel do anexo (`attachmentRole` / `fieldsForRole`)

Confirmar em `server/reading-policy.ts` e `server/document-evidence.ts`:

- `document` (contrato, aditivo, ato societário, procuração): fornece todos os campos aplicáveis à demanda, respeitando a qualificação da parte (`scopePartyReading`).
- `registration` (cartão CNPJ / comprovante cadastral): fornece exclusivamente `cnpj`, `razaoSocial`, `nomeFantasia`, `endereco`, `rua`, `numero`, `bairro`, `cep`, `cidade`, `estado`.
- `bank` (comprovante bancário / tela de conta / cheque Sicoob / tela Sicredi com cooperativa e conta): fornece exclusivamente `banco`, `agencia`, `conta`, `titularConta`, `documentoTitular`, `pix`. Nomes de arquivo genéricos (ex.: imagem do WhatsApp) só entram como `bank` quando o texto trouxer contexto explícito de conta e rótulos de agência/conta.
- `report` (planilha de descredenciamento / relatório): não fornece campos pelo `fieldsForRole`; apenas identifica a escola (`razaoSocial` e `cnpj`) via `reportIdentity` em demandas de descredenciamento ou relatórios de acerto.
- `counterproposal` (contraproposta): não fornece campos automaticamente (`fieldsForRole` retorna `{}`); exige decisão humana sobre as condições propostas.
- `simulation` (proposta de antecipação, simulação, parcelamentos contratados): não aprova condições automaticamente; em demandas de `Parcelamento`, `installmentTableFields` lê a linha da quantidade de parcelas solicitada, mantendo pendência de instrumento contratual.

## Matriz do que é necessário ler por tipo de demanda

Confirmar em `shared/official-fields.ts` e `server/comparison-profile.ts`:

- **Descredenciamento**: conferir apenas `razaoSocial` e `cnpj` da escola. Qualquer outro campo solicitado ausente no documento recebe `not_applicable`.
- **Contrato educacional / Termo de aceite / Pais x Escola** (`parentsContract`): quando o documento é o contrato entre escola e responsáveis financeiros (sem a Kedu no preâmbulo, mencionando anuidade e aluno/educando), conferir a **cláusula de cessão de créditos à Kedu** (`clausulaCessao` via `cessionClauseCheck`):
  - Cita expressamente a cessão à Kedu: `matches`.
  - Cita apenas cessão genérica de recebíveis/créditos a terceiros: `review` (exige confirmação humana).
  - Leitura integral e digital sem cláusula: `different`. Leitura parcial ou OCR sem encontrar: `missing`.
  - Dados cadastrais e bancários da escola ausentes nesse contrato recebem `not_applicable`.
- **Documentos que são apenas modelos (`templateDocument`)**: se todos os anexos legíveis tiverem 3 ou mais marcadores (`{{...}}` ou `<%...%>`), os campos de identidade e banco ausentes são `not_applicable` (modelo sem dados preenchidos).
- **Aditivo** (`officialRequirements` por subtipo, além da base da parte + `dataAssinaturaMatriz`):
  - `Vigência`: `inicio`, `fim`, `duracaoMeses`.
  - `Cashback`: `cashbackValor`.
  - `Conta bancária`: `banco`, `agencia`, `conta`, `titularConta`, `documentoTitular`.
  - `Taxa de remuneração`: `remuneracao`.
  - `Percentual/data de repasse`: `parcelas`, `repasse`, `diaRepasse`, `repasseSegundo`, `diaSegundoRepasse`.
  - Em instrumentos de `Aditivo` (sem subtipo bancário), `Distrato`, `Rescisão` ou `Parcelamento` que não trazem cláusula de dados bancários, os campos `banco`, `agencia`, `conta`, `titularConta`, `documentoTitular` e `pix` ausentes recebem `not_applicable` (`server/comparison-profile.ts`).
- **Contrato de garantia** (`contractRequirements` por modalidade):
  - `Garantia Completa` e `Garantia Conjunta`: qualificação da parte, `alunos`, `incorporaMatricula`, `cashbackValor`, `remuneracao`, `valor`, `inicio`, `fim`, `duracaoMeses`, dados bancários, `parcelas`, `repasse`, `diaRepasse`.
  - `Garantia Prevista`: todos os anteriores + `garantia`.
- **Nome fantasia (`nomeFantasia`)**: quando todos os instrumentos contratuais vigentes da demanda foram lidos por completo e não possuem cláusula ou rótulo de nome fantasia, o campo `nomeFantasia` ausente recebe `not_applicable` (`server/comparison-profile.ts`), pois contratos formais frequentemente qualificam apenas a razão social.

- **Cartão CNPJ com colunas.** A data de abertura pode aparecer na mesma linha do rótulo **Número de inscrição**. Verifique se o CNPJ começa na linha seguinte, se pertence à empresa do cartão e se os dígitos verificadores são válidos. Duas inscrições diferentes no mesmo bloco exigem associação adicional. Guarde a página e o trecho tal como lido.

## Fonte provável por campo (não exclusividade)

- Razão social/CNPJ/nome fantasia: qualificação contratual e documento cadastral, distinguindo cada rótulo. Alvará e cabeçalho comercial podem mostrar fantasia; preservar dúvida.
- Endereço/CEP/cidade/UF: sede explicitamente declarada ou cartão cadastral, não endereço do sócio, banco, foro ou Kedu. `rua` e `numero` lidos com valor único no mesmo documento compõem `endereco` (`withDocumentAddress`).
- Representante/CPF/poderes: cláusula societária ou procuração com validade/limites/atuação conjunta. Não inventar conferência jurídica ou situação cadastral atual por documento antigo.
- Banco/agência/conta/titular/CPF-CNPJ do titular: comprovante ou declaração com bloco explícito e conta correspondente. Transferência: isolar recebedor do pagador (`payerContext` em `server/guided-confirmation.ts`); saudação do aplicativo não comprova titular.
- Taxa/remuneração/repasse/cashback: cláusula/proposta aplicável e unidade explícita. Não misturar valor monetário e percentual ou confundir taxa bancária com taxa contratual.
- Quantidade/total/parcelas: tabela e cláusula correspondente; incluir moeda, quantidade, periodicidade e vencimentos. Se produto divergir do total explícito, registrar conflito; calcular via ferramenta sem sobrescrever o literal.
- Vigência/início/fim: cláusulas e aditivos posteriores (inclusive datas escritas por extenso em português via `guidedConfirmation`). Mês/ano não autoriza inventar o dia. Data de assinatura não é necessariamente início de vigência.
- Número de aditivo/matriz: histórico assinado e vínculo comprovado no sistema. Nome do arquivo ou rascunho não confirma sequência assinada.

## Suficiência e releitura direcionada (`targeted-reading`)

Confiança informada pelo OCR é metadado, não prova absoluta. Regras automáticas atuais devem ser conferidas em `server/comparison-evidence.ts`, `server/guided-confirmation.ts`, `server/verified-field-evidence.ts`, `server/contract-processing.ts`, `server/targeted-reading.ts` e módulos por campo. Não criar política paralela mais permissiva por esta skill.
- Um campo extraído da camada digital (`hasDigitalField`, incluindo `Docling — estrutura do PDF` com `nativeText: true` ou células literais de identidade em `XLSX`) permanece válido mesmo que outra página do arquivo tenha OCR pendente.
- Em PDFs digitalizados de uma ou mais páginas, o consenso sem conflito entre os passos `Tesseract` e `PaddleOCR` valida a evidência (`verifiedFieldEvidence`) desde que a página de origem (`origin.page` em `fieldOrigins`) esteja registrada.
- A releitura direcionada (`targetedReadingTargets`) atua apenas sobre páginas candidatas de campos em `missing` ou `review`, nunca apaga texto/campos já salvos (`mergeTargetedReading`) e preserva observações conflitantes para decisão humana.
