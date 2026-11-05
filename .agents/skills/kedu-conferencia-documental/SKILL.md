---
name: kedu-conferencia-documental
description: Use na conferência Kedu. Compare sem aprovar lacunas.
version: 1.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [kedu, glpi, conferencia, qualidade, evidencias]
    related_skills: [kedu-triagem-documental, kedu-leitura-precisa]
---

# Conferência documental Kedu

## When to Use — Quando usar

Após extrair campos de anexos Kedu, para comparar com a solicitação GLPI e distinguir erro de preenchimento, erro de leitura e falta de fonte. Para aprovação jurídica, seguir os responsáveis e controles do projeto; esta skill não os substitui.

## Procedimento

1. Fixar demanda, versão atual do chamado, documento e origem dos valores solicitados. Validar a referência GLPI: número inválido, várias empresas sem vínculo ou instruções conflitantes tornam a referência pendente, não o documento errado.
2. Conferir evidência independente do valor encontrado. Um candidato igual ao GLPI não é confirmação por coincidência. `same_after_basic_normalization` do MCP é apenas comparação auxiliar, não validação oficial.
3. Preservar os valores literais. Aplicar normalização somente à cópia de comparação, por campo: caixa/acentos/espaços/pontuação sem apagar palavras distintivas; máscaras de CPF/CNPJ mantendo todos os dígitos; valores e percentuais com unidade e separador inequívocos. Normalizações específicas do aplicativo devem ser verificadas no código atual; não presumir que retirar todos os caracteres não alfanuméricos basta para conta, nome ou valor.
4. Validar CPF/CNPJ e aritmética com ferramenta. Número inválido permanece literalmente como fornecido com achado; não reparar dígito ou completar zeros. Diferenciar razão social, fantasia e mantenedora; em banco usar código/nome comprovados e preservar agência, conta e dígito no literal.
5. Classificar cada campo: `confere` (valor explícito e associado, referência válida e equivalência comprovada); `divergencia_comprovada` (valor legível incompatível após normalização segura); `nao_localizado` (não apareceu nas fontes examinadas); `inconclusivo` (leitura/associação/cobertura insuficiente); `referencia_pendente`; `nao_se_aplica` (justificativa explícita). Estas são classificações do relatório, não valores para gravar diretamente no banco.
6. Distinguir erro do documento de erro na transcrição/OCR. No primeiro, propor correção do preenchimento; no segundo, propor corrigir leitura com prova do original. Não usar uma correção de valor contratual para esconder erro do leitor.
7. Propor resultado da demanda: Aguardando análise quando faltam prova/referência/cobertura; Aguardando correção somente com ao menos uma divergência real; Sem erros somente com todos os campos aplicáveis conferidos e nenhum bloqueio exigido pelo processamento. Divergência e pendências podem coexistir: listar ambas. Pronto para download, aprovação jurídica e assinatura são decisões adicionais do sistema, não sinônimos de Sem erros.
8. Entregar relatório com rastreabilidade; usar `references/esquema-relatorio.json` se houver saída JSON. O esquema organiza o relatório, não é payload da API. Não inventar hashes, responsáveis, páginas ou datas faltantes.
9. Por padrão, não gravar na aplicação. Se houver solicitação explícita para aplicar, usar sessão autorizada e fluxo integrado, com backup consistente verificado antes da intervenção, versão/revision atual, escopo fixo e auditoria. Não editar tabelas para promover status, não desativar travas e não registrar conferência humana ou gabarito em nome do usuário com base em IA.
10. Após escrita autorizada, reler o alvo exato e conferir valores, versão, pendências e auditoria. Em conflito 409, interromper e recarregar antes de propor nova ação; não forçar sobrescrita. Preservar Concluído, Cancelado e Em assinatura. Reconciliar a coorte antes/depois com `kedu-triagem-documental`.

## Armadilhas

- Não localizado não é dado inexistente, não informado ou não se aplica. Dado não informado exige exame das fontes pertinentes completas e versão fixada.
- Duas fontes discordantes ou múltiplos candidatos exigem associação, não escolha do que coincide com a referência.
- Resultado sintético não mede documentos reais. Redução de fila não comprova precisão nem autorização jurídica.
- Rotas de confirmação e correção de transcrição em `server/processing-routes.ts` criam revisão e gabarito atribuído à sessão humana. Não chamá-las para disfarçar revisão assistida como humana; se não existir caminho compatível, entregar proposta e registrar o bloqueio.
- Até GET de processamento pode recalcular/persistir resultados no servidor (`processingView`). Para diagnóstico estritamente somente leitura usar MCP/SQLite read-only, não presumir que todo GET é sem efeito.

## Verificação

- Valor encontrado e esperado permanecem separados, com documento/versão/localizador e entidade.
- Todos os campos aplicáveis têm classificação e próxima ação; nenhum vazio é aprovação.
- Não há promoção por coincidência com GLPI, remoção de pendências ou confirmação humana fictícia.
- Gravações, se autorizadas, foram relidas. Sem escrita, declarar resultado proposto e fila inalterada por esta análise.
