# Segunda leitura com IA

## Piloto gratuito Gemini

Teste ao vivo em 29/10/2026: `gemini-3.1-flash-lite` recuperou 5 de 5 campos da imagem fictícia (razão social, nome fantasia, cidade, agência e conta). Nenhum documento de produção foi enviado. `gemini-2.5-flash` retornou indisponibilidade para contas novas; `gemini-3.8-flash` não concluiu dentro do limite durante a verificação. Resultado sintético não mede fotos reais, PDFs longos ou redução de demandas em análise. O envio de produção permanece desativado no ambiente local.

Conector Gemini disponível com `DOCUMENT_VISION_PROVIDER=gemini`, `GEMINI_API_KEY` e `DOCUMENT_VISION_MODEL` (escolha um modelo que tenha cota gratuita na conta). Não há fallback pago automático nem configuração de faturamento pelo projeto. A chave não determina nem comprova o nível de faturamento; verifique a conta no Google AI Studio antes do teste.

Execute `npx tsx server/test-gemini-vision.ts`. O comando cria uma imagem fictícia com cinco campos, envia apenas essa imagem e compara a extração com o gabarito. Não aceita anexos reais como entrada. A chave não deve ser compartilhada no chat nem commitada. Sem chave/modelo, termina sem chamada externa.

Por padrão, a integração Gemini não fica disponível nas demandas reais: `GEMINI_PAID_DATA_APPROVED=false`. Essa proteção só deve ser alterada quando o serviço pago e o tratamento dos dados tiverem sido avaliados pela empresa. Uma resposta correta no teste sintético não comprova acurácia em fotos ruins nem reduz pendências de produção.

A integração está desligada por padrão. Não substitui OCR, não copia dados do GLPI e não confirma automaticamente valores sugeridos.

## Ativação no servidor

Configure `DOCUMENT_VISION_ENABLED=true`, `OPENAI_API_KEY` e `DOCUMENT_VISION_MODEL` no ambiente do servidor e reinicie a API. Use um modelo da conta com visão, PDFs e Structured Outputs. A conta precisa ter acesso e faturamento da API; não coloque a chave no navegador, no Git ou no chat.

Quando habilitada, a ação **Atualizar leitura** de um usuário executa a segunda leitura depois da leitura local. São no máximo dois anexos por ação, somente se houver campos não lidos ou a conferir. A sincronização agendada continua local, sem disparar custos externos. O envio inclui dados pessoais presentes no documento; a empresa deve configurar a conta e autorizar seu uso antes da ativação.

## O que é enviado

- Imagens: imagem orientada e redimensionada, primeira página/quadro.
- PDF: original de até seis páginas, com texto e imagens processados pelo provedor.
- Outros formatos: somente até 60 mil caracteres do texto extraído localmente; imagens incorporadas e paginação não são verificadas nessa modalidade.
- Limite de 10 MB por arquivo e 60 segundos na chamada externa.
- Apenas nomes dos campos solicitados, nunca os valores esperados do GLPI.

O pedido usa Responses API com `store:false`. Isso não é promessa de retenção zero pelo provedor; valem os controles da conta e do serviço.

## Resultados e limites

Cada sugestão registra valor, entidade, papel, página, trecho, modelo, data e assinatura do original e dos campos. O servidor valida o formato, os campos e a presença do valor no trecho declarado. Essa verificação não prova que o modelo citou o original corretamente: por isso, as sugestões ficam separadas na seção **Conferir campos individualmente** e precisam de conferência humana antes de salvar a transcrição. Não são criados registros humanos ou gabaritos pela IA.

O resultado local permanece intacto em falhas, recusas ou respostas inválidas. Tentativas idênticas, inclusive falhas, não são repetidas automaticamente. Para repetir uma chamada com o mesmo original e campos, é necessária uma rotina administrativa futura ou alteração da configuração/modelo; o botão sozinho não força nova tentativa idêntica.

Ainda faltam conta/modelo configurados, piloto com documentos reais, medição de acurácia/custo e aprovação de valores com evidência independente antes de automatizar a redução de Aguardando análise. Nenhuma redução de pendências é atribuída a esta integração sem essa medição.

Referências: [Visão](https://developers.openai.com/api/docs/guides/images-vision), [arquivos](https://developers.openai.com/api/docs/guides/file-inputs), [saídas estruturadas](https://developers.openai.com/api/docs/guides/structured-outputs).
