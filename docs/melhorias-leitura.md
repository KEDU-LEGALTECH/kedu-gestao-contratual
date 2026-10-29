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

## Atualização — recuperação segura e evidência (28/10/2026)

Esta regra substitui a aprovação ampla por coincidência descrita acima: em OCR, somente CPF/CNPJ com dígitos válidos, associação explícita à parte/campo, página e trecho do original podem ser confirmados automaticamente por correspondência ao GLPI. Nomes, cidade, CEP e conta exigem conferência humana quando a única evidência é OCR; texto digital independente e confirmações humanas continuam válidos. PDFs antigos sem origem por página não ganham confirmação presumida.

A fila automática preserva leituras saudáveis mesmo de versões antigas. Recupera falhas, leituras parciais e arquivos sem campos, com tentativas limitadas e intervalo. Os metadados são carregados sem os binários; apenas o arquivo em uso é carregado. Uma trava compartilhada entre API e ferramentas locais permite um leitor por vez. Falhas transitórias preservam a extração anterior utilizável.

O trabalhador é reciclado após cinco arquivos ou 256 MiB de RSS observados, e encerrado após 15 segundos ocioso. Com menos de 512 MiB livres, uma nova leitura pesada é adiada. Esses limites reduzem pressão de memória, mas não são uma garantia contra falta de memória do sistema. A medição separa espera em fila, leitura e encerramento; a ferramenta de medição também carrega um original por vez.

Validação limitada a dois DOCX reais: nenhum problema, dois campos preservados contra a referência anterior. A referência não possui confirmação humana nessa amostra, portanto isso mede estabilidade, não precisão absoluta. Não foi iniciada releitura integral da base. Checkpoint anterior à intervenção: ae48066. Relatórios, bancos e backups ficam em data/, fora do Git.

## Correção — comparação por campo (28/10/2026)

Endereço passa a reunir rua e número observados no mesmo anexo, após a seleção da parte contratual. Componentes ambíguos e endereço explícito são preservados, sem preencher a extração com a referência GLPI. Campos com valor comprovado na camada digital podem conferir mesmo se outra página estiver parcial; as pendências estruturais, de partes e do documento inteiro permanecem. OCR continua com a política estrita anterior.

A tabela distingue atualização pendente de campo não localizado na extração. Anexos de versões anteriores não são adotados silenciosamente. No GLPI #2026102224, os cinco originais foram obtidos e comparados byte a byte aos salvos; somente por serem idênticos as extrações foram vinculadas à versão atual, sem novo OCR. O endereço passou a conferir. GLPI #2026102238 mantém a pendência de PDF parcial, com razão social e CNPJ avaliados individualmente.

Validação desta correção: 238 testes passaram e build concluído. Reavaliação das comparações salvas sem releitura integral. Backup verificado anterior à mudança de dados: data/backups/kedu-2026-10-28T17-13-54-363Z-c2c04bd2.sqlite.

### Pontuação em nomes — 28/10/2026

Comparação de razão social, nome fantasia e titularidade ignora aspas comuns/tipográficas (incluindo aspas incompletas e angulares), vírgulas e pontos. Apóstrofos não criam espaços artificiais no nome. Espaços são normalizados antes de remover sufixos societários. Palavras e números diferentes continuam distintos; CNPJs de empresas distintas permanecem divergentes. Testes incluem os nomes José de Alencar do exemplo, CNPJs distintos, pontuação final e nomes com números diferentes. Comparações existentes foram reavaliadas sem OCR.

## Recuperação persistente — 28/10/2026

A fila agora usa reading_jobs (migração 017): demanda, versão do chamado, estado, tentativas, próxima execução e dono do trabalho. Só um trabalho automático é reivindicado por vez. Reinício devolve o trabalho interrompido à fila sem consumir tentativa; versões superadas e demandas encerradas são descartadas. Há até três tentativas por versão, separadas por 10 e 20 minutos. Esgotamento mantém análise pendente; não transforma falha em aprovação. Repetir a varredura não recria trabalhos esgotados. A API continua necessária para executar a fila: o banco não executa OCR sozinho.

Somente a demanda realmente iniciada aparece como Analisando. A pausa administrativa é consultada antes de cada arquivo, além da drenagem da fila. Anexos saudáveis não são relidos só por versão antiga do leitor. O original atual é baixado e seu hash de bytes comparado à versão anterior antes de reaproveitar uma extração saudável. Mudança de bytes exige leitura nova.

PDFs registram listas de páginas concluídas e pendentes; páginas OCR completas permanecem no cache local e são reutilizadas nas tentativas seguintes, enquanto resultados parciais de página não são aprovados. A camada digital ainda é inspecionada para reconstruir o documento; isso não implica refazer OCR em todas as páginas.

Validação: 241 testes passaram, incluindo exclusividade, retomada, tentativas limitadas, cache por página e anexos idênticos versus alterados; build concluído. Amostra real de quatro originais ausentes da versão atual: todos recuperados via GLPI; um com leitura saudável reutilizada após identidade dos bytes, três aguardando leitura. Não houve integração com OCR em nuvem nem releitura de todos os originais. Backup anterior: data/backups/kedu-2026-10-28T17-35-00-883Z-af0bd7f9.sqlite.

## Conferência global dos campos pendentes — 28/10/2026

Rodada local autorizada: 112 arquivos examinados na recuperação de texto/camada digital (21 atualizados), 25 anexos atuais obtidos do GLPI, 105 arquivos relidos, cinco novas tentativas dirigidas a cartões cadastrais e nova tentativa no PDF antes recusado pelo limite de páginas. Originais e confirmações humanas preservados. Não foi adicionado serviço de OCR em nuvem.

Esta regra substitui a exigência ampla de confirmação humana de todo OCR: campos explicitamente identificados, com concordância entre passadas, confiança mínima de 85 no campo/página e origem em página conhecida podem ser conferidos automaticamente. Coincidência com GLPI isolada continua insuficiente. Percentuais/cálculos, contrapropostas e simulações continuam com regras específicas. 0260, Nu Pagamentos e Nubank continuam equivalentes; hífen da conta é ignorado na comparação.

Adicionados reconhecimento de Empresa: na Junta Comercial, cláusulas explícitas de nome empresarial/sede e leitura ampliada de blocos de cartões CNPJ em PDF. Rótulos Contratante no pedido deixam de integrar a razão social; cidade não incorpora UF/inscrição municipal. CPF/CNPJ inválido no GLPI e CEPs conflitantes no próprio pedido exigem confirmação da referência, sem mandar corrigir o arquivo. Descrição de serviço não é nome da parte contratual; sufixo isolado como LTDA - PB não é identidade. Frase não numérica não vira percentual fora da faixa.

Um arquivo com contagem de páginas conhecida, integralmente lido e todos os campos solicitados comprovados deixa de herdar revisão genérica de campos OCR não usados. Arquivos parciais, fórmulas, ambiguidade e decisões de contraproposta permanecem bloqueados. Campos digitais independentes evitam confirmação duplicada de documento de apoio.

PDF: limite ampliado a 200 páginas, mantendo limites de bytes/texto/memória/tempo. O orçamento não é mais dividido entre todas as páginas (o que podia deixar nenhuma delas terminar); páginas úteis são concluídas e as restantes retomadas do cache. A migração 018 registra progresso na fila; esgotamento acontece após três tentativas consecutivas sem progresso, permitindo continuar enquanto páginas/campos novos forem recuperados.

Medição contra backup de 18:07 UTC, 91 demandas ativas: análise 63 → 56; sem erros 22 → 28; correção 6 → 7. Campos que conferem 115 → 142; a conferir 77 → 71; não localizados 174 → 146; referências ambíguas 0 → 6. Diferenças de etapa e causas restantes: data/resultado-conferencia-2026-10-28.md e .json. Não se trata de precisão aferida por gabarito humano: é uma medição do resultado operacional das regras e leituras. O PDF longo continuou sem texto recuperável pelo leitor local; isso não comprova que o original esteja vazio.

Validação final: build concluído e 254 testes aprovados. Backup anterior à rodada: data/backups/kedu-2026-10-28T18-07-56-053Z-809b6528.sqlite. Bancos, originais e relatórios pessoais permanecem fora do Git.

## Recuperação contextual — Instituto Miró / Polaris (28/10/2026)

A recuperação contextual agora é aplicada na saída de readProcessingFile para todos os formatos suportados, antes da persistência. A cláusula de sede fornece CEP/cidade/UF, sem usar residência pessoal; UF é apresentada por extenso. Nomes fantasia e titularidade nominal não são presumidos a partir da razão social.

Dados bancários em capturas de aplicativo reconhecem o cabeçalho Dados bancários Copiar todos. O CNPJ dentro dessa seção fornece documentoTitular, com evidência restrita à seção e validação de dígitos. A chave Pix isolada, o CPF pessoal e blocos com pagador/remetente/beneficiário não são adotados como titularidade. CNPJs com nomes de empresas no pedido são separados; a tela mostra Conferir empresas e os respectivos nomes, sem a mensagem incorreta de CNPJ inválido por concatenação.

Aplicação local aos documentos importados: 191 arquivos examinados; cinco arquivos enriquecidos em quatro demandas, sem novo OCR e preservando confirmações humanas. No GLPI #2026102257, CEP 58280-000, Mamanguape, Estado da Paraíba e documento do titular 53.258.260/0001-28 passaram a Confere. Razão social, endereço, banco, agência e conta também conferem. Nome fantasia, nome do titular e associação dos CNPJs às empresas permanecem pendentes de comprovação apropriada.

Validação: 259 testes passaram e build concluído. Relatório local: data/contextual-recovery-report.json. A empresa informou não possuir conta de nuvem com faturamento; nenhuma API externa de extração foi ativada e nenhum documento foi enviado a um novo provedor.
