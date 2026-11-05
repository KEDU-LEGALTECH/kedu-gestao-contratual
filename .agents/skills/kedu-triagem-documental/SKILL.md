---
name: kedu-triagem-documental
description: Use na fila Kedu. Priorize pendências com evidência.
version: 1.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [kedu, glpi, documentos, triagem]
    related_skills: [kedu-leitura-precisa, kedu-conferencia-documental]
---

# Triagem documental Kedu

## When to Use — Quando usar

Para organizar arquivos sem leitura, Aguardando análise ou Aguardando correção do projeto `C:\Users\Raissa Reis\Documents\kedu_sistema` (WSL: `/mnt/c/Users/Raissa Reis/Documents/kedu_sistema`). Fora desse projeto, não aplicar regras Kedu. O exemplo Bernoli inspira evidências e validação, não regras processuais.

## Procedimento

1. Ler `references/protocolo-fila.md`. Confirmar pasta, fonte de dados, escopo e data real. A criação/carregamento da skill não autoriza executar lote, reativar fila, baixar anexos ou alterar demandas.
2. Para diagnóstico usar `list_pending_demands(status="Aguardando análise", limit=50, offset=0)` no MCP já configurado. Repetir offset por quantidade retornada até reconciliar `counts.pending_demands`. Consultar Aguardando correção separadamente se solicitado. Não instalar/configurar MCP sem necessidade e autorização. Se indisponível, usar ferramenta local comprovadamente somente leitura; não executar scripts que importam inicialização/migrações do banco para um simples diagnóstico.
3. Fixar coorte com IDs de demanda, GLPI, documentos, versão/hash do chamado e data. Separar etapa operacional `demands.stage`, status de processamento `contract_processing.status` e status original GLPI. O campo `stage` retornado por esse MCP representa o status de processamento, não a etapa operacional. Excluir Concluído, Cancelado e Em assinatura da recuperação, mesmo que apareçam na listagem MCP.
4. Inventariar anexos atuais e cópias anteriores sem sobrescrever. Nome igual não prova bytes iguais; hash de conteúdo igual permite evitar extração repetida, mas não dispensa associação/validação por demanda e versão. Não excluir arquivos, nem retirar pendências só para reduzir o contador.
5. Classificar causa: `nao_baixado`, `versao_desatualizada`, `falha_leitura`, `leitura_parcial`, `campo_nao_localizado`, `associacao_ambigua`, `referencia_glpi_ambigua`, `dado_nao_informado`, `formato_nao_suportado`, `limite_recurso` ou `divergencia_comprovada`. São categorias do relatório, não novos estados do banco. Permitir mais de uma causa por arquivo e avisar que totais de causas podem se sobrepor.
6. Priorizar por prazo explícito e prioridade real, depois por possibilidade de resolver: texto digital já disponível; revisão dirigida de poucos campos; páginas OCR pendentes; download ausente pelo fluxo autorizado; solicitação de documento ausente. Não repetir OCR para suprir informação que realmente não consta na fonte.
7. Para leitura auxiliar chamar `kedu-leitura-precisa`. Para comparação chamar `kedu-conferencia-documental`. Trabalhar serialmente em lotes pequenos, preservando progresso em relatório local solicitado. Usar anexos e IDs reais, nunca selecionar somente pelo nome da organização.
8. Entregar contagens separadas de demandas, anexos únicos por demanda/versão, páginas examinadas e campos. Distinguir diagnóstico, leitura auxiliar, proposta de correção e atualização efetivamente gravada. Redução de fila só existe se verificada no fluxo oficial sobre a mesma coorte.

## Armadilhas

- As ferramentas MCP atuais não baixam originais do GLPI nem escrevem o resultado oficial. Leitura auxiliar não muda status na aplicação.
- `list_pending_demands.offset` pagina demandas; `read_pending_batch.attachment_offset` pagina anexos. Não intercambiar.
- A paginação da fila viva não é um snapshot: mudanças de status podem saltar itens. Fixar IDs e repetir inventário para detectar entradas/saídas.
- Não copiar .env, banco, documentos ou dados pessoais para provedores externos. Não alterar outro perfil Hermes.
- Não executar `--apply`, SQL de escrita, limpeza, aprovação em lote ou retomada de tarefas sem escopo autorizado e backup consistente.

## Verificação

- Reconciliar IDs e totais por ferramenta/código, sem soma mental.
- Cada causa tem documento/versão e evidência ou erro observável; ausência de acesso não é ausência de dado.
- Relatar casos sem anexo, excluídos por etapa, duplicados e arquivos não suportados.
- Não prometer redução, acurácia ou leitura integral sem medição. Informar o bloqueio e a próxima ação verificável.
