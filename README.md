# Kedu — Central de contratos

**Produção:** Vercel + Supabase (PostgreSQL e Storage), com `KEDU_DATABASE=postgres` e o esquema `kedu_migration`; veja [deploy/VERCEL.md](deploy/VERCEL.md). O SQLite (`data/kedu.sqlite`) é só a cópia local e a base dos testes. Migrações novas (a partir de `migrations/020.sql`) precisam funcionar nos dois bancos e ser repetíveis (`IF NOT EXISTS`): o SQLite as roda a cada início e o PostgreSQL as aplica uma única vez, registradas em `schema_migrations` (`server/migrations.ts`). Ao mudar uma regra de conferência, troque a etiqueta em `fingerprint()` e rode `npm run rules:record`; o teste `tests/rules-version.test.ts` falha se isso for esquecido. Os testes rodam no GitHub a cada pull request (`.github/workflows/testes.yml`).

> As seções abaixo descrevem a versão local original e podem estar desatualizadas.

Em **Demandas**, as abas **Todas**, **Abertos / novos** (status GLPI 1, 2 e 3) e **Pendentes no GLPI** (status 4) se aplicam à tabela e ao Kanban. “Todas” preserva o acesso aos registros manuais e aos chamados solucionados/fechados já importados. A prioridade exibida e o filtro usam o valor da origem para chamados GLPI, mantendo a prioridade interna para demandas manuais. `GLPI_INCLUDE_OPEN=true` busca todas as páginas dos status abertos, independentemente do lote de recentes; `GLPI_MAX_OPEN=2000` é um limite de segurança por status, com falha explícita se excedido, sem importação parcial. Nenhum documento ou chamado é alterado na origem.

Na página **Chamados GLPI**, as listas **Demais chamados** e **Pendentes no GLPI** usam o status original (código 4 para pendente), com prioridade original e ordenação da maior para a menor. Essa situação não se confunde com a validação documental da demanda. `GLPI_INCLUDE_PENDING=true` habilita a busca adicional por pendentes antigos; `GLPI_MAX_PENDING=200` limita essa busca separadamente de `GLPI_MAX_TICKETS`. Se o limite for excedido, a sincronização falha antes de salvar um lote incompleto. Os filtros de pesquisa são identificados pela API e o vínculo aos grupos/tipos de ator autorizados é conferido antes da importação. Pendentes anteriormente importados são consultados novamente para acompanhar mudanças de status. Credenciais e campos corrigidos localmente não são substituídos; a integração permanece somente leitura no GLPI.

Preparação para a equipe e Supabase: veja [deploy/LEIA-ME.md](deploy/LEIA-ME.md). O runtime continua em SQLite; `supabase:check` é diagnóstico, sem migração automática. Há backups online verificados e agendamento por `BACKUP_INTERVAL_HOURS`, inventário offline (`migration:prepare`), pacote de revisão dos modelos (`legal:package`) e verificação de pendências (`production:check`). Relatórios e CSV acompanham as etapas de processamento da lista de Demandas; encerramentos e assinatura permanecem preservados.

O fluxo principal de Demandas é **GLPI → leitura automática → validação → correção, quando necessária → download no modelo correspondente**. A lista distingue Analisando, Aguardando análise, Aguardando correção e Pronto para download. Originais ficam disponíveis mesmo com pendências. O download final é bloqueado no servidor até a validação.

A leitura aceita DOCX, DOC, PDF digital ou digitalizado, PNG/JPEG/WebP/TIFF/BMP/GIF, TXT/CSV, ODT, XLSX e PPTX. PDF usa PDF.js; imagens e páginas digitalizadas passam por Tesseract local em português, com idioma instalado pelo npm (sem serviço externo). OCR e leitores de Office alternativos exigem conferência humana do texto com o original. Limites: 20 MB, 30 páginas/quadros/planilhas/slides e 180 segundos por arquivo; documentos acima dos limites ou ilegíveis permanecem inconclusivos. Não há suporte universal a qualquer extensão, manuscrito ou arquivo protegido. Veja `entregas/Leitura_Multiformato_OCR_2026-10-21.md` para detalhes e resultados reais. A geração do contrato final continua em DOCX no modelo validado.

Aplicação local em português, com React/TypeScript/Vite, Express/TypeScript e SQLite relacional (`node:sqlite`). Requer Node.js 24.21 ou superior. O diretório estava vazio na implementação inicial. O banco em disco preserva as demandas, arquivos, versões, conferências e decisões; não há dependência exclusiva de localStorage.

## Preparar e iniciar

A carga fictícia requer `DEMO_SEED=true`, definido no `.env.example` para instalações de demonstração. O Compose respeita a variável do `.env` e usa `false` quando ela não está definida. Sem essa ativação, não são criados usuários, demandas ou modelos demonstrativos. Bancos que passaram pela limpeza administrativa recebem `settings.demoDisabled=true`, que impede a recriação dos exemplos mesmo se uma variável antiga continuar ativada.

```powershell
npm ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm run db:prepare
npm run dev
```

Acesse http://127.0.0.1:5173. A API fica em http://127.0.0.1:3001. Ambos escutam somente em loopback. O Vite mantém a porta 5173 fixa. Para build local:

```powershell
npm run build
npm start
```

Depois do build, a aplicação fica em http://127.0.0.1:3001. Em `NODE_ENV=production`, cookies exigem HTTPS. Configure `ALLOWED_ORIGINS` com as origens exatas autorizadas, separadas por vírgula. Fora de produção, HTTP em localhost/127.0.0.1/IPv6 loopback é permitido em qualquer porta.

## Executar com Docker (demonstração local)

Instale e abra o Docker Desktop, com containers Linux e Docker Compose v2. Não precisa instalar Node.js ou executar `npm install` no computador para esta opção. Após clonar o repositório, entre na pasta e execute:

```powershell
docker compose up --build -d
docker compose ps
docker compose logs -f app
```

A primeira construção precisa de internet para baixar a imagem Node e as dependências. Quando o serviço iniciar, abra **http://127.0.0.1:8080**. O frontend compilado e a API são servidos juntos; não execute `npm run dev` dentro do container. Somente em um banco demonstrativo com `DEMO_SEED=true`, sem bloqueio por limpeza, as contas e os dados fictícios são preparados na inicialização. Nesse caso, o login inicial é `admin@demo.kedu.local`, senha `Kedu-demo-2026!`. Um banco vazio sem demonstração exige provisionamento administrativo; não recebe usuário padrão automaticamente.

O banco e os arquivos enviados ficam no volume nomeado `kedu-data`, separado do banco `data/kedu.sqlite` usado fora do Docker. Reiniciar ou recriar o container preserva esse volume. O build não copia `.env`, banco local, relatórios internos ou credenciais para a imagem. A aplicação roda como usuário sem privilégios de root.

Para parar e retomar, preservando os dados:

```powershell
docker compose down
docker compose up -d
```

Para atualizar após baixar alterações:

```powershell
git pull
docker compose up --build -d
```

Para usar outra porta, crie ou edite o `.env` local com `DEMO_PORT=8081` e recrie o serviço. É possível definir `DEMO_PASSWORD` antes da primeira inicialização; alterar a variável depois não redefine senhas existentes. Não envie o `.env` ao GitHub.

`docker compose down --volumes` **apaga o banco e os arquivos da demonstração Docker**. Use somente se quiser reiniciar a demonstração do zero; o banco local fora do Docker não é afetado.

Esta configuração é exclusivamente para avaliação no próprio computador: a porta publicada está restrita a `127.0.0.1`, o GLPI fica em demonstração e o ambiente permite modelos demonstrativos e cookies HTTP locais. Não é configuração de produção nem fornece um link público. Para publicação real, configurar HTTPS, origens autorizadas, segredos, backups e modelos oficiais. A variável `HOST` permite escutar na interface do container; sem configuração, a execução local continua restrita ao loopback.

## Banco e atualização de instalações anteriores

Migrações: `migrations/001.sql` a `011.sql`. O servidor as aplica ao iniciar (004: retratos de aditivos e cashback em centavos; 005: origem, homologação e prévias dos modelos oficiais; 006: chamados GLPI e versões imutáveis; 007: classificação de instrumentos; 008: proveniência cadastral GLPI; 009: classificação das organizações; 010: recebimento das demandas; 011: arquivos imutáveis de matrizes externas). A 007 classifica registros antigos sem reescrever seu histórico. Faça backup consistente com `npm run db:backup` antes de atualizar uma instalação com dados reais. O comando reabre a cópia e verifica integridade e referências. Preserve banco, arquivos reais e `.env` fora do Git.

A migração de governança reinicia a confirmação e invalida aprovações de demandas abertas da versão anterior uma única vez. Demandas concluídas/canceladas preservam seu histórico. Os novos requisitos precisam ser completados antes de avançar. Se uma demanda antiga estiver em assinatura com pendências, devolva-a com justificativa antes de corrigir os dados. Modelos demonstrativos antigos permanecem no histórico; quando necessário, o servidor cria nova versão e inativa a anterior para novas gerações. Não altera conteúdo de versão aprovada.

Há entidades separadas para usuário/sessão, escola, representante, contrato/matriz/aditivo, demanda, modelo/versão, documento/versão, conferência, aprovação, auditoria, sincronização, condições comerciais inteiras, governança, evidências, histórico assinado, revisões humanas e registro manual de assinatura.

## Contas demonstrativas

### Organizações provenientes do GLPI

Cada sincronização real registra organizações identificáveis nos chamados já importados, exigindo CNPJ com dígitos verificadores válidos e razão social informada. A migração `008.sql` registra origem, chamado e fontes. A migração `009.sql` classifica importações existentes e novas como **Aguardando classificação**; não presume que toda empresa seja escola. A comparação usa CNPJ normalizado, sem criar duplicação por pontuação. Cadastros existentes não são sobrescritos: divergências de razão social ficam registradas e continuam sujeitas a conferência.

Em **Organizações**, uma pessoa autorizada confere os documentos e confirma Escola, Fornecedor ou Outra organização, com justificativa, declaração e auditoria. Apenas a categoria Escola aparece em **Escolas**. Fornecedores e outras organizações podem ser usados nos tipos fornecedor/marketing, mas não em operações escolares. Pendentes não podem criar demandas. A classificação exige a versão atual e não é sobrescrita pela sincronização ou reinício. Reclassificações incompatíveis com demandas/contratos existentes são bloqueadas. O botão “Atualizar organizações dos chamados” aproveita os chamados já importados, sem nova consulta ao GLPI. Endereço e contato ausentes permanecem vazios. O cadastro é formado pelos chamados reais sincronizados, não por uma listagem global de todas as instituições existentes no GLPI; o limite de chamados continua valendo.

Senha inicial: `Kedu-demo-2026!`. `DEMO_PASSWORD` altera a senha antes da primeira preparação; não redefine contas já existentes.

| E-mail                      | Perfil        | Função                                                                       |
| --------------------------- | ------------- | ---------------------------------------------------------------------------- |
| admin@demo.kedu.local       | Administrador | Cadastro, configurações e todas as ações para demonstração                   |
| solicitante@demo.kedu.local | Solicitante   | Criar/editar próprias demandas; sem dados bancários, downloads ou aprovações |
| operacao@demo.kedu.local    | Operação      | Elaborar, confirmar dados, conferir, registrar arquivos e assinatura         |
| risco@demo.kedu.local       | Risco         | Elaborar, conferir, revisar poderes e validar por Risco                      |
| financeiro@demo.kedu.local  | Financeiro    | Conferir evidências e validar por Financeiro                                 |
| juridico@demo.kedu.local    | Jurídico      | Revisão e aprovação jurídica; aprovação de modelos                           |
| aprovador@demo.kedu.local   | Aprovador     | Aprovação comercial complementar; não substitui Risco/Financeiro             |
| consulta@demo.kedu.local    | Consulta      | Leitura sem acesso bancário, arquivos restritos ou exportação                |

As permissões são verificadas no servidor. Risco, Financeiro e Jurídico não validam um pelo outro. O administrador possui permissões amplas para a demonstração. A equipe deve homologar a segregação institucional antes de produção. Solicitantes acessam apenas suas demandas; os demais perfis internos acessam a operação.

## Fluxo completo

1. Crie uma demanda e selecione a escola, tipo, responsável, prioridade e prazo.
2. No controle jurídico, registre a referência do chamado GLPI e a declaração de consulta manual. Isso não é validação via API.
3. Defina a sexta-feira do reporte. A revisão deve ocorrer até a quinta-feira anterior; validações atrasadas exigem justificativa auditada.
4. Registre os signatários e a regra societária: somente um administrador nomeado ou todos os sócios. Anexe contrato social e alterações; uma pessoa responsável deve verificar os poderes.
5. Anexe e verifique cada evidência exigida. Complete os campos comerciais, endereço, localidade Fortaleza, CE, datas e modalidade. Confirme os dados críticos.
6. Gere DOCX com modelo aprovado correspondente ao tipo/subtipo. Também é possível anexar minuta externa antes de gerar, selecionando um modelo aprovado e vinculando o chamado.
7. Execute a conferência estrutural. Divergências ou resultado inconclusivo devolvem a demanda, invalidam aprovações e impedem o avanço.
8. Registre os cinco eixos humanos: Estrutura; Dados e consistência; Tipo e autorização; Português e redação; Assinaturas. Registre localização, problema e correção em achados. A aplicação não substitui o revisor humano.
9. Encaminhe para aprovação e registre as validações obrigatórias conforme a política abaixo.
10. Encaminhe para assinatura. Esse evento não comprova envio a provedor nem assinatura concluída.
11. Confirme que o arquivo final corresponde à versão aprovada e tem os signatários exigidos. Registre o arquivo DOCX/PDF declarado como assinado e conclua. A autenticidade não é verificada automaticamente.

Etapas: Recebido, Aguardando informações, Em elaboração, Em conferência, Em aprovação, Em assinatura, Concluído, Devolvido e Cancelado. Cancelamento/devolução exigem justificativa. Demandas encerradas não permitem reabrir etapas. Alterações em dados, governança ou evidências reiniciam confirmação/versão dos dados e invalidam aprovações. Uma nova minuta cria versão documental. Conferências, validações e revisões humanas são associadas à versão exata.

## Aditivos e regras jurídicas

As validações obrigatórias seguem a matriz de responsabilidades do Manual de Contratos (`shared/responsibility.ts`), exibida no detalhe de cada demanda com executor, validadores, observadores e seção do manual.

| Tipo | Validações exigidas | Observação |
| --- | --- | --- |
| Aditivo de vigência, repasse, cashback ou taxa | Risco | Jurídico observa (§5.2) |
| Aditivo de conta bancária | Risco + Financeiro | §5.2 |
| Contrato de garantia — Completa ou Conjunta | Risco | Jurídico e Financeiro observam (§3, §4.2) |
| Contrato de garantia — Prevista | Risco + Jurídico | Manual ambíguo; mantido o controle jurídico até validação |
| Migração de modalidade | Risco + Jurídico | Exige demandas de distrato e de novo contrato vinculadas (§4.3) |
| Antecipação K-invest e parcelamento | Jurídico + Financeiro | Confissão de Dívida obrigatória (§9) |
| Distrato | Jurídico + Financeiro | “Ciência do Financeiro” registrada como validação (§8.2) |
| CNPJ solidário, renovação com pendências, alteração societária | Risco + Jurídico | §5.3 e §6 |
| Contratos educacional, marketing e fornecedor; descredenciamento | Jurídico | §3 e §11 |

Alteração de corpo fixo, poderes societários e demais exceções acrescentam o controle jurídico. Configurações permite exigir o Jurídico também para tipos ou subtipos indicados em `legalPolicies`; mudanças de política reabrem demandas ativas para nova confirmação e invalidam aprovações.

Outras regras aplicadas: o representante legal informado no documento precisa constar entre os signatários com poderes conferidos; a migração não pode ser concluída antes do distrato e do novo contrato; o registro da assinatura é bloqueado se a última conferência da versão atual não for conforme; a conclusão exige o arquivo assinado; e, quando a demanda veio de um chamado GLPI, CNPJ, razão social e taxa (se o formulário trouxer) divergentes do chamado viram pendência.

Modalidades governadas: Garantia Completa, Garantia Conjunta e Garantia Prevista. CNPJ solidário exige o CNPJ adicional e comprovação de nexo econômico. Renovação com pendências exige contratos anteriores e demonstrativo financeiro. O conteúdo e a adequação jurídica das evidências dependem de revisão humana registrada.

### Numeração pelo histórico assinado

Em Contratos e aditivos, Risco/Administrador registra o último número efetivamente assinado consultado manualmente no Clicksign ou Clint, referência, data e declaração de conferência. Use zero se houver apenas matriz. O histórico confirmado é imutável e não pode retroceder. Não existe consulta automática a esses serviços.

O próximo número é exatamente o último assinado confirmado + 1. A reserva usa transação `BEGIN IMMEDIATE` e índice único por matriz. Reservas canceladas não são reutilizadas automaticamente. Na conclusão de um aditivo, o histórico local recebe o número e a referência do documento declarado como assinado.

## Telas e indicadores

Dashboard; Demandas em tabela/Kanban; Chamados GLPI (triagem somente leitura); Detalhe com modelo oficial, prévias, responsáveis, origem dos dados, controle jurídico e checklist; Escolas; Contratos/aditivos; Modelos; Relatórios; Configurações. Busca por escola/CNPJ/GLPI e filtros por responsável, etapa, tipo, prioridade e prazo. Kanban é de visualização: não permite arrastar para contornar regras.

Datas são apresentadas em America/Sao_Paulo. No dashboard: abertas excluem Concluído/Cancelado; vencidas são abertas com prazo anterior a hoje; aprovação/assinatura usam a etapa atual; concluídas e tempo médio usam conclusões no mês atual. Tempo médio: dias corridos da criação à conclusão. Relatórios filtram criação, com datas inclusivas, e mostram responsável, etapas, vencimentos, tempo e última conferência divergente. CSV respeita permissão e filtros, neutralizando fórmulas maliciosas.

O relatório de revisão jurídica contém APROVADO, APROVADO COM RESSALVAS ou REPROVADO, os cinco eixos, achados e pendências numeradas, com exportação TXT. O resultado agrega conferência estrutural, dados, evidências, validações e revisão humana registrada. Não constitui parecer jurídico automático. Minuta desatualizada, ausência de confirmação/validação ou pendência crítica impede status aprovado.

Dinheiro é persistido como centavos e percentuais em pontos-base inteiros (7,70% = 770; R$ 10.000,00 = 1000000). Remuneração, garantia e repasse são independentes. Retratos documentais preservam strings decimais canônicas.

## Modelos, DOCX e evidências

### Modelos oficiais do Canva

Os modelos vigentes do Canva prevalecem. `templates/official/` contém as oito adaptações para automação (três contratos e cinco aditivos), o `catalog.json` com hashes e os arquivos de proveniência. Na inicialização, o servidor registra cada arquivo listado no catálogo como **rascunho pendente de homologação**, uma única vez por hash; um arquivo alterado gera nova versão e nunca altera as anteriores.

As adaptações são geradas por `scripts/build-official-models.py` a partir dos PDFs do Canva (em `data/canva-conversion/qa`, fora do Git; requer Python com `python-docx` 1.2 e PyMuPDF). As caixas posicionadas viram parágrafos sombreados e tabelas; os campos do Canva viram controles de conteúdo Word bloqueados (`kedu:<campo>`). O script falha se qualquer palavra de um PDF não chegar ao DOCX ou se sobrar marcador sem mapeamento. Logotipo gráfico, ícones, rodapé de cada página e numeração de páginas não são reproduzidos — parte da homologação visual.

Fluxo: dados confirmados → **prévia** (marca “NÃO UTILIZAR PARA ASSINATURA” e mostra “⟨PENDENTE: campo⟩” onde faltar dado) → conferência visual → **homologação** pelo Jurídico, com referência e declaração, vinculada ao hash exato do arquivo e imutável → **geração** da minuta, apenas com versão homologada e sem pendências → conferência campo a campo e do corpo fixo → revisão humana → validações → assinatura → conclusão. Prévias não podem ser enviadas como minuta. Modelos estruturados não são liberados pelo botão genérico “Aprovar versão”.

Valores derivados (`shared/official-fields.ts` e `shared/extenso.ts`): datas por extenso (“1º de novembro de 2026”), mês e ano, números e valores por extenso, percentuais por extenso (“sete inteiros e setenta centésimos por cento”), percentual restante da Garantia Prevista e ordinal do aditivo a partir da numeração reservada (“SEGUNDO ADITIVO AO”). Nada é deduzido de dados ausentes: duração incompatível com início e fim e datas fora do dia 01 nas Garantias Completa e Conjunta bloqueiam a geração.

Divergências entre manuais e Canva ficam listadas na tela Modelos para validação da equipe (título do aditivo, procurador, PIX, testemunhas, redação do cashback, soma dos repasses, numeração “3.6.2.” repetida na fonte da Garantia Prevista). O sistema não corrige a redação da fonte.

Os arquivos `templates/official/aditivo-vigencia-v1.docx`, `vigencia-provenance.json`, `scripts/build-vigencia-template.py` e `shared/vigencia-model.ts` são da primeira tentativa e foram substituídos; não estão no catálogo e podem ser removidos.

### Modelos demonstrativos e envio manual

O catálogo também mantém um contrato e cinco aditivos demonstrativos, identificados como DEMONSTRAÇÃO e bloqueados em produção. Ao cadastrar um DOCX pela tela Modelos, um arquivo com controles `kedu:` e perfil reconhecido é tratado como modelo estruturado (exige prévia e homologação; para contrato, informe a modalidade); os demais seguem o formato de demonstração `campo: {campo}`.

Minutas/modelos DOCX: até 5 MB, 512 componentes ZIP e 20 MB descompactados. Conteúdo ativo, referências externas, caminhos inseguros, alterações controladas, campos Word dinâmicos, desenhos, objetos, caixas de texto e cabeçalhos/rodapés são rejeitados ou tornam a conferência inconclusiva.

Evidências: DOCX ou PDF até 8 MB, com download autorizado como anexo. O arquivo mais recente de cada tipo exige verificação própria. PDF é armazenado como evidência ou documento final assinado, sem conferência automática. Arquivo assinado não pode ser substituído silenciosamente.

## GLPI e integrações externas

Instalação informada: GLPI 10.0.26; o endereço da API (`.../apirest.php`) fica somente em `GLPI_URL` no `.env` local. O adaptador real (`server/glpi.ts`) segue a documentação oficial da API REST do GLPI 10 (`apirest.md`): `initSession` com `App-Token` e `Authorization: user_token`, `Session-Token` nas chamadas, `killSession` ao final, paginação por `range`/`Content-Range` e subitens `/:itemtype/:id/:sub_itemtype`. **Somente GET**; nenhum endpoint de plugin, webhook ou escrita.

Leitura: resolve os grupos autorizados por nome exato (`GLPI_GROUPS`, padrão “JURIDICO CONTRATOS;JURIDICO REVISÃO”) ou por id (`GLPI_GROUP_IDS`); lê `Group/<id>/Group_Ticket` filtrando o tipo de ator (`GLPI_ACTOR_TYPES`, padrão 2 = atribuído); e, por chamado, `Ticket/<id>`, `ITILFollowup` e `Document_Item` + `Document/<id>` (somente nome, tipo e hash; os arquivos não são baixados). Há tempo limite por requisição, tentativas limitadas apenas para falhas temporárias, limite de chamados e tokens ocultos nas mensagens.

Importação (`server/glpi-sync.ts`): cada chamado real gera uma demanda em **Recebido**, sem duplicação pelo número GLPI. A tela **Demandas** concentra a conferência da solicitação original e dos anexos. Organização, tipo, responsável e prazo precisam ser confirmados por uma pessoa; dados ausentes não são inventados. Organizações ainda não classificadas podem ser classificadas no recebimento. Nenhum contrato ou número de aditivo é reservado antes dessa confirmação. Geração, upload e avanço operacional ficam bloqueados enquanto o recebimento estiver pendente. Alterações posteriores no GLPI geram nova versão e sinalização, preservando dados, documentos e aprovações locais. Chamados GLPI mantém a sincronização e o histórico técnico. O agendamento continua opcional e desativado por padrão.

Exemplo de um chamado real de vigência: o sistema aponta que o dia exato da nova vigência e o efeito sobre a data final não foram informados, que os anexos precisam ser conferidos e registrados como evidências e que um arquivo chamado “primeiro aditivo” não comprova a sequência assinada.

Para ativar: no `.env` local (nunca no Git), `GLPI_MODE=real`, `GLPI_URL`, `GLPI_APP_TOKEN` e `GLPI_USER_TOKEN`; reinicie e use “Sincronizar agora”. A conexão e o download foram validados com os grupos autorizados na instalação real; os testes automatizados usam um servidor GLPI simulado. Na primeira execução real, confirme que os grupos são encontrados, que `Group_Ticket` é legível pelo perfil do token, como o formulário aparece no conteúdo do chamado e se os anexos são retornados. Anexar o documento assinado e encerrar o chamado continuam sendo feitos no GLPI; a central registra essa declaração separadamente da conclusão local. `SignatureProvider` é interface futura; Clicksign/Clint não estão conectados.

## Segurança e limites operacionais

### Modelos editáveis e análise de anexos

Em Modelos, **Baixar DOCX editável** entrega a versão oficial do catálogo para Word/Google Docs, com homologação preservada como pendência quando aplicável. Na demanda, **Analisar valores do contrato recebido** compara os campos selecionados de um anexo DOCX com valores e referência conferidos pelo operador. Resultado divergente encaminha para correção manual; ausências, ambiguidades, imagens e PDFs são inconclusivos. O original, cada correção e os resultados são imutáveis (migração 012). As análises não substituem revisão contratual, conferência do modelo ou assinatura. Veja `entregas/Modelos_Editaveis_e_Analise_GLPI_2026-10-21.md` para o fluxo e limites.

Na triagem de um chamado real, “Baixar anexo” consulta o arquivo original via GET `Document/:id?alt=media`. A Central exige sessão autenticada e permissões `files` e `bank`, verifica o anexo no chamado importado e reconfirma no GLPI o grupo atribuído e o vínculo do documento. Tokens ficam no backend. O download tem limite de 20 MB, tempo máximo e limite de requisições; é entregue como anexo com `no-store`. A sincronização continua trazendo somente metadados: o arquivo é baixado sob demanda e não se torna evidência verificada automaticamente.

Na seleção GLPI, “recentes” significa maiores números de chamado (`tickets_id`), em ordem decrescente, e não a data da última alteração ou o ID do vínculo com o grupo. A ordenação é solicitada ao GLPI antes da paginação; vínculos duplicados e tipos de ator não autorizados não consomem o lote. Os candidatos de cada grupo são unidos e o limite global só é aplicado depois. A leitura é interrompida se a API devolver ordem inconsistente ou se forem examinados 10.000 vínculos por grupo sem completar o lote nem alcançar o fim. Não há retorno silencioso de um lote parcial nesses casos.

A revisão de segurança adicionou rejeição de campos duplicados no DOCX e controle de versão no salvamento comercial. A API exige `expected_version` igual a `data_version`; versões antigas ou ausentes recebem HTTP 409, sem sobrescrever dados. A interface envia a versão aberta; em conflito, reabra a demanda e revise antes de reenviar.

Cadastro/edição de escolas e representantes exigem a permissão `schools`, disponível para Administrador, Operação e Risco. Solicitantes consultam somente escolas e contratos vinculados às próprias demandas, veem somente seu usuário na lista e não podem criar vínculos com escolas alheias. A operação deve preparar a primeira vinculação quando necessário.

Em produção, configure `DEMO_SEED=false` e use banco separado sem contas demonstrativas. O servidor recusa a inicialização se a carga fictícia estiver ativada ou se encontrar usuários `@demo.kedu.local`; não apaga nem transforma o banco antigo. Para provisionar o primeiro administrador em banco vazio, defina `ADMIN_NAME`, `ADMIN_EMAIL` e `ADMIN_PASSWORD` (mínimo 16 caracteres, exclusiva) no ambiente protegido e execute `npm run admin:prepare`. Remova `ADMIN_PASSWORD` após a execução. Nunca publique essas variáveis nem reutilize a senha demonstrativa. Prepare HTTPS e origens autorizadas antes de disponibilizar o ambiente real.

Senhas com scrypt/salt; sessões aleatórias de oito horas em cookie HttpOnly/SameSite Strict; limite de login; autorização no backend e downloads; validação de dados; controle de origem; arquivos com limites; auditoria sem ações de edição/exclusão expostas. O banco local contém dados sensíveis e não possui cifragem em repouso própria. A implantação precisa de HTTPS, proteção de armazenamento, backup/restauração, retenção, gestão corporativa de identidades e revisão dos acessos compartilhados.

Cadastro de representantes permanece simples; edição cadastral de escola é bloqueada enquanto há demandas abertas. Contatos/endereço são campos livres. Poderes societários, português, pertinência das cláusulas, nexo econômico e autenticidade da assinatura dependem das pessoas responsáveis. Não há garantia automática de validade jurídica ou conformidade com a LGPD.

## Testes

```powershell
npm test
npm run build
```

Testes usam banco temporário independente e HTTP local. `essential` cobre fluxo, permissões, conferência, numeração e CSV; `official-models`, os oito modelos e o fluxo oficial; `glpi`, o adaptador somente leitura com servidor simulado; `rules`, responsabilidades e operações jurídicas; `regressions`, classificação de instrumentos, produção, encerramento, concorrência de governança, campos por operação e assinados de até 8 MB. Há também testes de validação, origens e produção. Build inclui TypeScript.

### Correções de integridade de 20/10/2026

Operações jurídicas ficam identificadas pelo tipo e pela matriz de origem, inclusive registros antigos; não podem ser selecionadas como matriz nem receber histórico de numeração. Novas conclusões dessas operações recebem status `Concluído`. Distrato, descredenciamento e migração atualizam a matriz de origem para `Distratado`, `Descredenciado` e `Migrado`, respectivamente, na mesma transação da conclusão. Migração exige distrato da mesma matriz e novo contrato concluídos. Registros históricos não têm seus estados reescritos automaticamente.

A governança exige `expected_version`, obtido como `data_version` no GET de governança; uma versão antiga ou ausente retorna HTTP 409 sem sobrescrever signatários ou requisitos. Os dados de origem e flags do sistema são preservados. Modelos demonstrativos são bloqueados em produção na geração, upload, avanço, registro de assinatura e conclusão. Demandas concluídas/canceladas rejeitam nova conferência antes de gravar revisões ou alterar etapas.

Os campos mínimos e os campos exibidos das operações específicas ficam em `shared/request-policy.ts` (`operationFields`), sem herdar taxas e contas de um contrato de garantia. Evidências e validadores continuam seguindo a governança. Minutas e modelos têm limite de 5 MB; evidências e documentos finais assinados, 8 MB.

Interface adaptada à identidade analisada em kedu.com.br: Poppins, azul petróleo, azul vivo, fundos claros e componentes consistentes; tokens em `src/style.css`. Google Fonts exige rede, com Arial de fallback.

A alteração de Corpo Fixo detectada pela conferência ativa controle jurídico obrigatório persistente. Ressalvas/reprovações humanas exigem ocorrências estruturadas (localização, problema, correção, gravidade); uma ocorrência crítica só pode ser registrada como reprovação.

Após a conclusão local de um aditivo, a próxima emissão exige nova confirmação manual do último assinado no Clicksign/Clint. Operações jurídicas sobre contrato existente exigem matriz assinada da mesma escola já na criação.

## Adequação aos manuais e ao exemplo de chamado

A migração `004.sql` é aplicada automaticamente na inicialização e preserva os registros anteriores. Cria retratos imutáveis dos dados anteriores dos aditivos e armazenamento do valor de cashback em centavos. Não carrega dados do chamado real nem transforma os anexos em evidências verificadas.

Na criação de um aditivo, selecione o subtipo e uma matriz assinada da escola escolhida. O formulário filtra as matrizes e os campos da proposta por operação: vigência exige início e fim exatos; taxa exige remuneração; repasse exige percentual e data; conta exige banco, agência, conta e titularidade; cashback exige valor em reais. Dados de identificação, formalização, histórico e evidências continuam obrigatórios. Demais operações conservam as exigências anteriores até sua adequação específica.

No detalhe, em **O que será alterado**, registre os valores atuais conferidos no contrato e no histórico assinado, com referência documental e declaração humana. Depois preencha e salve a proposta. O sistema não deduz o dia de um mês citado no chamado, não consulta Clicksign, não confirma a autenticidade da fonte e não corrige automaticamente valores. A nova confirmação do retrato incrementa a versão dos dados e invalida aprovações. As minutas geradas registram o retrato anterior e a proposta na versão exata. Os modelos demonstrativos recebem nova versão quando a estrutura muda; versões aprovadas anteriores são preservadas.

O checklist passou a exigir identificação do responsável, cartão CNPJ com conferência cadastral e comprovante bancário, além do contrato social. Conta de terceiro acrescenta procuração pública específica; Garantia Prevista acrescenta anexo de assunção da dívida. Esses controles são evidências verificadas manualmente, sem consulta automática à Receita Federal. O distrato exige também Financeiro. Não se atribui aprovação jurídica automática aos documentos.

O campo **Valor do cashback (R$)** é monetário (`cashbackValor`); o antigo cashback percentual permanece identificado como legado e não é convertido silenciosamente. Uma demanda histórica em assinatura que precisar complementar as novas exigências deve ser devolvida com justificativa e passar novamente por elaboração e aprovação.

As conversões gráficas do Canva em `entregas/modelos_canva` servem apenas de referência visual; a automação usa as adaptações de `templates/official` (ver “Modelos oficiais do Canva”), ainda pendentes de homologação jurídica.

Para conferir a adequação: `npm test` cobre aditivo de vigência sem exigências comerciais alheias, datas incompletas, retrato imutável, restrição bancária, edição concorrente e invalidação após nova conferência. `npm run build` inclui a checagem de tipos.

