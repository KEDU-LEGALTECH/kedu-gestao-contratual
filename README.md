# Kedu — Central de contratos

Aplicação local em português, com React/TypeScript/Vite, Express/TypeScript e SQLite relacional (`node:sqlite`). Requer Node.js 24.21 ou superior. O diretório estava vazio na implementação inicial. O banco em disco preserva as demandas, arquivos, versões, conferências e decisões; não há dependência exclusiva de localStorage.

## Preparar e iniciar

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

## Banco e atualização de instalações anteriores

Migrações: `migrations/001.sql`, `002.sql` e `003.sql`. O servidor as aplica ao iniciar. Faça backup consistente do banco antes de atualizar uma instalação com dados reais. Preserve `data/kedu.sqlite` e não versione banco, arquivos reais ou `.env`.

A migração de governança reinicia a confirmação e invalida aprovações de demandas abertas da versão anterior uma única vez. Demandas concluídas/canceladas preservam seu histórico. Os novos requisitos precisam ser completados antes de avançar. Se uma demanda antiga estiver em assinatura com pendências, devolva-a com justificativa antes de corrigir os dados. Modelos demonstrativos antigos permanecem no histórico; quando necessário, o servidor cria nova versão e inativa a anterior para novas gerações. Não altera conteúdo de versão aprovada.

Há entidades separadas para usuário/sessão, escola, representante, contrato/matriz/aditivo, demanda, modelo/versão, documento/versão, conferência, aprovação, auditoria, sincronização, condições comerciais inteiras, governança, evidências, histórico assinado, revisões humanas e registro manual de assinatura.

## Contas demonstrativas

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

| Tipo                                            | Validações mínimas |
| ----------------------------------------------- | ------------------ |
| Conta bancária                                  | Risco + Financeiro |
| Vigência                                        | Risco              |
| Percentual/data de repasse                      | Risco              |
| Cashback                                        | Risco              |
| Taxa de remuneração                             | Risco              |
| Casos jurídicos, demais instrumentos e exceções | Risco + Jurídico   |

Alteração de corpo fixo, poderes societários, renovação com pendências e outros casos jurídicos retiram a autonomia do aditivo simples. Configurações permite exigir Jurídico adicionalmente para subtipos indicados na lista `legalPolicies`. Os casos obrigatórios não podem ser dispensados pela configuração. Mudanças de política reabrem demandas ativas para nova confirmação/versão e invalidam aprovações.

Modalidades governadas: Garantia Completa, Garantia Conjunta e Garantia Prevista. CNPJ solidário exige o CNPJ adicional e comprovação de nexo econômico. K-invest e parcelamento exigem Confissão de Dívida. Migração exige distrato e novo contrato como evidências verificadas. Renovação com pendências exige contratos anteriores e demonstrativo financeiro. O conteúdo e a adequação jurídica dessas evidências dependem de revisão humana registrada.

### Numeração pelo histórico assinado

Em Contratos e aditivos, Risco/Administrador registra o último número efetivamente assinado consultado manualmente no Clicksign ou Clint, referência, data e declaração de conferência. Use zero se houver apenas matriz. O histórico confirmado é imutável e não pode retroceder. Não existe consulta automática a esses serviços.

O próximo número é exatamente o último assinado confirmado + 1. A reserva usa transação `BEGIN IMMEDIATE` e índice único por matriz. Se já existir reserva desse número, outra solicitação é bloqueada. Não se pulam números apenas porque outra minuta está em andamento. Reservas canceladas não são reutilizadas automaticamente: a equipe precisa reconciliar a situação real antes de nova emissão. Na conclusão de um aditivo, o histórico local recebe o número e a referência do documento declarado como assinado.

## Telas e indicadores

Dashboard; Demandas em tabela/Kanban; Detalhe com controle jurídico e checklist; Escolas; Contratos/aditivos; Modelos; Relatórios; Configurações. Busca por escola/CNPJ/GLPI e filtros por responsável, etapa, tipo, prioridade e prazo. Kanban é de visualização: não permite arrastar para contornar regras.

Datas são apresentadas em America/Sao_Paulo. No dashboard: abertas excluem Concluído/Cancelado; vencidas são abertas com prazo anterior a hoje; aprovação/assinatura usam a etapa atual; concluídas e tempo médio usam conclusões no mês atual. Tempo médio: dias corridos da criação à conclusão. Relatórios filtram criação, com datas inclusivas, e mostram responsável, etapas, vencimentos, tempo e última conferência divergente. CSV respeita permissão e filtros, neutralizando fórmulas maliciosas.

O relatório de revisão jurídica contém APROVADO, APROVADO COM RESSALVAS ou REPROVADO, os cinco eixos, achados e pendências numeradas, com exportação TXT. O resultado agrega conferência estrutural, dados, evidências, validações e revisão humana registrada. Não constitui parecer jurídico automático. Minuta desatualizada, ausência de confirmação/validação ou pendência crítica impede status aprovado.

Dinheiro é persistido como centavos e percentuais em pontos-base inteiros (7,70% = 770; R$ 10.000,00 = 1000000). Remuneração, garantia e repasse são independentes. Retratos documentais preservam strings decimais canônicas.

## Modelos, DOCX e evidências

O catálogo inclui cinco tipos de aditivo com versões demonstrativas específicas e um contrato demonstrativo. Todos são identificados como MODELO DE DEMONSTRAÇÃO — SEM APROVAÇÃO JURÍDICA. Não contêm cláusulas jurídicas inventadas. Em produção, geração por modelo demonstrativo é bloqueada. Os corpos fixos oficiais de `manual_contratos.md` e `modelos_aditivo.md` não estavam nos materiais recebidos; o Jurídico deve fornecer e homologar os documentos reais.

Cadastre um modelo com tipo/subtipo e indique se é demonstrativo ou oficial a submeter à aprovação. Rascunhos precisam de aprovação do Jurídico. Versões aprovadas são imutáveis; alterações criam nova versão. Inativação preserva o histórico. Um modelo de outro tipo/subtipo não pode gerar ou servir de base à minuta.

Docxtemplater/PizZip preenche apenas variáveis autorizadas, sem IA reescrevendo cláusulas. Neste interpretador, o quadro resumo usa um parágrafo por campo, no formato `remuneracao: {remuneracao}`. A conferência compara os campos e a sequência de parágrafos fixos normalizados, sem depender do hash global. Detecta variáveis com chaves e marcadores comuns como `[DADO]`, `[NOME]`, `[CNPJ]`, `[VALOR]` e `[DATA]`. Falhas de interpretação resultam em inconclusiva ou rejeição segura no upload.

Minutas/modelos DOCX: até 5 MB, 512 componentes ZIP e 20 MB descompactados. Conteúdo ativo, referências externas, caminhos inseguros, alterações controladas, campos Word dinâmicos, desenhos, objetos e cabeçalhos/rodapés não são suportados. Modelos jurídicos complexos precisam de homologação e evolução do interpretador; não se promete fidelidade a qualquer DOCX.

Evidências: DOCX ou PDF até 8 MB, com download autorizado como anexo. O arquivo mais recente de cada tipo exige verificação própria, mesmo que exista versão antiga verificada. PDF é armazenado como evidência/final assinado, não conferido automaticamente. Minutas PDF continuam fora da conferência. Arquivo assinado não pode ser substituído silenciosamente.

## GLPI e integrações externas

O usuário informou que ainda não possui acesso ao GLPI. O modo real permanece bloqueado. Não foram inventados endpoints, autenticação ou webhooks. `.env.example` documenta `GLPI_MODE`, `GLPI_URL`, `GLPI_VERSION`, `GLPI_APP_TOKEN` e `GLPI_USER_TOKEN`. Segredos ficam no servidor.

O adaptador demonstrativo importa quatro registros em duas páginas, com identificador externo único, controle de paginação, limites, timeout, tentativas limitadas e histórico. Repetir a importação não duplica nem sobrescreve registros locais. Na origem fictícia, ID/escola/tipo/prioridade vêm do adaptador; CNPJ/razão social são do cadastro local; condições confirmadas, documentos, etapas e aprovações são locais.

Para modo real: identificar versão/API, consultar documentação oficial correspondente, implementar autenticação/leitura/mapeamento e homologar em chamados de teste. Preencher tokens não ativa uma integração inexistente. Não há escrita em chamados reais. `SignatureProvider` é interface futura; Clicksign/Clint não estão conectados e nenhum envio/assinatura é simulado como integração ativa.

## Segurança e limites operacionais

Senhas com scrypt/salt; sessões aleatórias de oito horas em cookie HttpOnly/SameSite Strict; limite de login; autorização no backend e downloads; validação de dados; controle de origem; arquivos com limites; auditoria sem ações de edição/exclusão expostas. O banco local contém dados sensíveis e não possui cifragem em repouso própria. A implantação precisa de HTTPS, proteção de armazenamento, backup/restauração, retenção, gestão corporativa de identidades e revisão dos acessos compartilhados.

Cadastro de representantes permanece simples; edição cadastral de escola é bloqueada enquanto há demandas abertas. Contatos/endereço são campos livres. Poderes societários, português, pertinência das cláusulas, nexo econômico e autenticidade da assinatura dependem das pessoas responsáveis. Não há garantia automática de validade jurídica ou conformidade com a LGPD.

## Testes

```powershell
npm test
npm run build
```

Testes usam banco temporário independente e HTTP local; o ambiente precisa permitir loopback. Cobrem diferenças de taxas/CNPJ/conta, obrigatórios, corpo fixo, placeholders, conferência inconclusiva, invalidação, idempotência, permissões, numeração concorrente pelo histórico assinado, imutabilidade, CSV, fluxo completo, autonomia dos cinco aditivos, Risco/Financeiro, documentos especiais, poderes, reporte semanal, minuta externa e evidência substituída. Build inclui TypeScript.

Interface adaptada à identidade analisada em kedu.com.br: Poppins, azul petróleo, azul vivo, fundos claros e componentes consistentes; tokens em `src/style.css`. Google Fonts exige rede, com Arial de fallback.

A alteração de Corpo Fixo detectada pela conferência ativa controle jurídico obrigatório persistente. O formulário de governança não consegue remover esse encaminhamento automático. Ressalvas/reprovações humanas exigem ocorrências estruturadas (localização, problema, correção, gravidade); uma ocorrência crítica só pode ser registrada como reprovação.

Após a conclusão local de um aditivo, a próxima emissão exige nova confirmação manual do último assinado no Clicksign/Clint. A reconferência fica em registro separado, sem editar o histórico anterior. Operações jurídicas sobre contrato existente exigem matriz assinada da mesma escola já na criação.
