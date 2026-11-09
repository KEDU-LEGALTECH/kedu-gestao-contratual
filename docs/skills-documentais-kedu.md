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
