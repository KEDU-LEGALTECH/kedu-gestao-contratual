# Piloto de cinco demandas — 29/10/2026

Foram selecionadas cinco demandas que estavam em Aguardando análise e cinco anexos com campos pendentes. A comparação abaixo se limita a esse grupo; não é uma medição de todo o acervo.

## Resultado aplicado

| GLPI | Antes | Depois | Resultado e pendências restantes |
| --- | --- | --- | --- |
| 2026101595 | Aguardando análise | Aguardando correção | Alvará identifica T C DE SANTANA SANTOS. Cidade impressa: Candeias; referência do GLPI: Salvador. Dados bancários e outros campos continuam pendentes. |
| 2026101284 | Aguardando análise | Aguardando análise | Nome fantasia, endereço, CEP, cidade e UF passaram a conferir. Ainda há pendências bancárias e necessidade do instrumento contratual. |
| 2026102058 | Aguardando análise | Sem erros | Recebedor separado do pagador; banco, agência, conta, titular e CNPJ conferem. CNH lida sem informação solicitada não bloqueia comparações já verificadas. |
| 2026102253 | Aguardando análise | Aguardando análise | Endereço corrigido na extração para número 3004; cadastro conferido. Faltam dados bancários nos anexos disponíveis. |
| 2026102256 | Aguardando análise | Aguardando análise | CNPJ do fornecedor identificado sem adotar o CNPJ da Kedu. Razão social completa e valor total não constam na página conferida; não foram inventados a partir do GLPI. |

Dos campos que estavam pendentes, **12 passaram de sem valor localizado para Confere**, **8 passaram de Conferir leitura para Confere** e **1 divergência real foi identificada**. Restaram 15 campos sem valor (incluindo 2 ausências confirmadas visualmente), 4 a conferir e a divergência de cidade. Aguardando análise caiu de 5 para 3 nesse grupo; uma demanda foi para Sem erros e outra para Aguardando correção.

## O que foi corrigido no código

- Alvará: distinguir NOME OU RAZÃO SOCIAL de NOME FANTASIA e interpretar CIDADE/ESTADO em colunas.
- Comprovante de transferência: selecionar exclusivamente o bloco completo Recebedor; não misturar conta, agência, instituição ou CPF do pagador.
- Cabeçalho de fornecedor: recuperar o CNPJ explícito antes do corpo do contrato, sem transformar logotipo em razão social.
- Endereço: zeros à esquerda no número predial não alteram o número.
- Evidências visuais assistidas: campo, página, trecho, empresa, identificação do arquivo, hash do original e do texto lido. Não são confirmações do usuário nem aprovação jurídica; não criam gabaritos humanos.
- Ausência confirmada em todas as páginas: mostrar Dado não informado, separadamente de falha de OCR. A constatação perde validade se o texto ou a versão do arquivo mudar.

## Limite da IA local

O Qwen3-VL 2B Instruct rodou serialmente e somente em loopback, sem envio dos anexos a serviço externo. No alvará, confundiu fantasia com razão social; no comprovante, os três valores pedidos estavam corretos, mas a entidade ainda foi mal representada em alguns itens. Três respostas foram recusadas pela validação de evidências. Portanto, **o resultado aplicado não veio de aprovação automática das cinco respostas da IA**: houve correções dos leitores e conferência visual independente dos originais pelo assistente. As sugestões inseguras não foram promovidas.

Os originais permaneceram intactos. Foi criado backup consistente antes da atualização, e a fila automática foi pausada apenas para a manutenção. Relatórios detalhados e recortes ficam em `data/pilot-five/`, fora do Git.

## Próximo limite a resolver

Ainda é necessário melhorar o reconhecimento de rótulos/entidades do modelo pequeno e a validação de suas respostas antes de habilitar processamento em lote. Os casos com dados ausentes ou documento bancário não enviado não serão resolvidos por repetir OCR ou IA. A leitura por API gratuita do Gemini continua bloqueada para anexos reais.
