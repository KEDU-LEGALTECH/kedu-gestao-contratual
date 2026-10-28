# Leitura e conferência de documentos — 27/10/2026

O pedido do GLPI é a referência solicitada. Ele não substitui o conteúdo efetivamente lido no arquivo. Uma leitura inconclusiva permanece em análise; apenas divergência identificada com leitura conclusiva exige correção.

## Implementado

- Origem por campo: contrato social/procuração para representante; cartão CNPJ para endereço; comprovante para dados bancários; proposta/contrato para condições financeiras. Outras fontes válidas continuam aceitas. Anexo desconhecido ou inacessível não é considerado ausente.
- A tabela diferencia documento de origem não enviado/identificado, fonte ainda desconhecida, anexo parcial/ilegível e campo não localizado.
- PDF: camada digital de todas as páginas primeiro, orçamento por página, Paddle/OpenCV antes do Tesseract quando a leitura permite, reconhecimento da área real de logos/máscaras repetidas. Páginas completas podem ser retomadas pelo cache e arquivos parciais têm até três tentativas automáticas por chamado/versão, espaçadas em dez minutos.
- Word contendo somente uma digitalização chega ao OCR; documentos com conteúdo inseguro continuam recusados.
- Nome e CPF em cláusulas explícitas de representação, administração e procuração; sócios não são presumidos representantes. Ambiguidades não são resolvidas copiando o GLPI.
- Validações locais de CPF/CNPJ, datas, percentuais, parcela × quantidade versus total explícito e consistência de titularidade. Para CEP/cidade/UF, somente contradições entre documentos são apontadas: não houve consulta geográfica externa.
- Confirmação de campo ou documento e correção explícita de transcrição geram gabarito local, vinculado ao hash do original, à extração, ao autor e à evidência. O benchmark separa acerto em campos conferidos de alterações contra uma referência não verificada. Isso mede o leitor; não treina um modelo automaticamente.

## Resultado observado na base local

Foram auditadas 80 demandas ativas, com 163 anexos atuais. A recuperação supervisionada acrescentou 15 campos em sete arquivos: datas, representante/CPF e dados cadastrais. O inventário passou de 293 para 308 pares arquivo/campo. Nenhum campo anterior desapareceu e nenhum arquivo original teve os bytes alterados. Esses ganhos de extração não equivalem a uma medição de acurácia humana dos documentos reais.

A comparação com o GLPI contém agora 202 campos ainda não identificados: 19 sem documento de origem identificado entre os anexos, 51 com fonte desconhecida, 124 não localizados em documentos presentes e oito associados a falha ou leitura parcial. A referência passou a incluir também total e valor da parcela, portanto não é correto comparar somente o número bruto de pendências com o diagnóstico antigo.

Cinco arquivos ainda têm leitura parcial. A recuperação não os aprovou como completos. As novas retomadas por página estarão disponíveis no leitor versão 4; anexos já conferidos por humanos não são substituídos pelo processamento automático. Arquivos de demandas encerradas ou em assinatura foram preservados.

## Verificação e reprodução

- Suíte completa: 218 testes aprovados. Build de produção aprovado.
- Auditoria: `npx tsx server/reading-improvement-audit.ts`.
- Recuperação local: `npx tsx server/recover-reading.ts --apply`; acrescentar `--ocr-partial` para os PDFs parciais. O comando cria backup verificado e recusa substituir automaticamente uma leitura quando detecta perda de campos ou alteração concorrente.
- Medição contra gabarito: `npm run reading:benchmark`, opcionalmente com `--format pdf --limit 10`. O script informa separadamente os campos conferidos por humanos.
- Relatórios detalhados e backups permanecem em `data/`, fora do Git. Código existente foi copiado antes da edição para `data/code-snapshots/`.

Consultas cadastrais externas e IA com visão em nuvem não foram implementadas/ativadas. Permanecem dependentes da decisão sobre serviço, credenciais, custos e envio de documentos para fora. O processamento e o gabarito desta entrega são locais.

## Atualização — extratores de texto e falsos erros (27/10/2026, noite)

- Novos extratores locais, aplicados a qualquer formato depois da leitura do texto: parágrafo de qualificação das partes (`server/qualification-reading.ts`: razão social, nome fantasia, CNPJ, endereço, cidade/UF, CEP e representante com CPF válido) e dados bancários em bloco, declaração de conta, Pix e extrato (`server/bank-reading.ts`). A empresa Kedu (raiz de CNPJ 45.543.580) nunca é tomada como a escola.
- Valores impossíveis deixaram de virar dados: rótulos lidos como valor ("DATA DE ABERTURA", "BAIRRO/DISTRITO"), CNPJ/CPF com dígito inválido e percentuais sem forma de percentual (`server/field-plausibility.ts`).
- Comparação: sufixo societário, pontuação e aspas não indicam outra empresa ("LTDA." = "LTDA" = "LTDA - ME"); bancos são comparados pelo código (Nubank = Nu Pagamentos = 0260); zeros à esquerda da agência são ignorados.
- Quando o documento traz vários valores e um deles confere com o GLPI, o campo vai para conferência, não para correção.
- Endereço comparado por rua e número; bairro, cidade e UF presentes em só uma das fontes não geram divergência.
- Valor distintivo (CNPJ/CPF válido, CEP, conta, nome com duas ou mais palavras) lido por OCR e idêntico ao GLPI conta como leitura confirmada. Valores curtos (taxas, números, UF) continuam exigindo duas leituras concordantes ou conferência humana.
- `server/recover-reading.ts --apply` agora relê os arquivos digitais com os extratores atuais e aplica os novos extratores ao texto de OCR já salvo, sem refazer OCR.

Simulação em cópia do banco (80 demandas): campos que conferem 70 → 137; divergências 46 → 7; "Aguardando correção" 44 → 5.
