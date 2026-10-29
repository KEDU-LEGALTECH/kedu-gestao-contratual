# Leitura local de imagens

O leitor mantém texto e tabelas nativos de PDF, DOCX, DOC, ODT, PPTX, XLSX, TXT e CSV. Fotos, páginas escaneadas e imagens incorporadas compatíveis passam por OCR local. O conteúdo identifica formatos conhecidos mesmo quando a extensão está incorreta; um arquivo `.img` desconhecido não é presumido imagem.

## Preparação no Windows

Use Python 3.12 de 64 bits (aceita 3.9 a 3.13). Na raiz do projeto:

```powershell
powershell -File server/ocr/setup.ps1 -Python 'C:\caminho\python.exe'
```

O script cria `data/ocr-venv`, instala as versões de `requirements.txt`, baixa modelos oficiais em `data/ocr-models`, executa inferência de teste e só então grava `data/ocr-runtime.json`. Esses arquivos são locais e ignorados pelo Git. O ambiente principal do computador não é alterado.

PaddlePaddle 3.2.2 foi fixado porque a versão 3.3.1 apresentou incompatibilidade de oneDNN no Windows durante os testes. Os modelos usados são PP-OCRv5 mobile de detecção, reconhecimento latino e classificação de orientação. A inferência roda na CPU e não envia documentos à nuvem.

## Funcionamento

- OpenCV reduz sombras, aplica contraste local e corrige perspectiva apenas quando encontra uma borda de página suficientemente ampla. Mantém uma leitura independente da imagem original.
- PaddleOCR lê original e imagem preparada. Tesseract e a leitura por blocos continuam como fontes alternativas.
- Campos novos precisam concordar nas duas versões; conflitos com a leitura anterior permanecem visíveis. Confirmação automática exige evidência de alta confiança e comparação com o GLPI.
- Texto digital mantém origem própria. Cálculos de planilhas, decisões jurídicas, documentos incompletos e condições de contrapropostas continuam com controles separados.
- Se o motor adicional falhar ou exceder seu limite de tempo, preserva a leitura alternativa e informa a falha. O processo externo tem limite de tempo e acompanha a vida do leitor pai no Windows.

Defina `OCR_ENGINE=legacy` para desativar o motor adicional. Testes unitários não carregam modelos por padrão; testes reais podem definir `OCR_ENGINE=paddle`. Para instalação em outro computador/servidor, execute novamente o setup; não copie credenciais ou documentos para o repositório.

Imagens pequenas decorativas em arquivos Office não disparam OCR. Imagens grandes ilegíveis exigem conferência; DOC binário antigo não oferece o mesmo suporte a imagens incorporadas do DOCX. Formatos não suportados precisam de uma cópia acessível, sem apenas renomear sua extensão.

## Processo de leitura e cache

Um único processo de leitura atende arquivos seguidos e reaproveita o processo Python/PaddleOCR. O Tesseract é iniciado quando necessário e encerrado por documento. O leitor é substituído após falha, tempo limite ou 20 arquivos, e encerrado após 2 minutos sem uso.

Leituras concluídas ficam em `data/reading-cache.sqlite` e são reaproveitadas quando chega o mesmo arquivo (mesmos bytes e nome). O cache é descartado automaticamente quando muda o código do leitor (`server/`, `shared/`), as dependências ou a configuração do OCR, e cada leitura expira em 30 dias, porque o texto extraído contém dados pessoais. Falhas, leituras parciais e leituras feitas sem o PaddleOCR configurado nunca entram no cache. Defina `READING_CACHE=off` para desativá-lo.

## Medição da leitura

`npm run reading:benchmark` relê os originais guardados no banco e compara os campos com a referência local `data/reading-gold.json` (fora do Git, pois contém dados pessoais). O relatório mostra, por formato, campos iguais, perdidos, divergentes e novos, além do tempo médio.

- `npm run reading:benchmark -- --seed` acrescenta à referência os originais que ainda não estão nela, usando a leitura atual.
- `--format pdf` limita a um formato; `--limit 10` limita a quantidade de arquivos.
- Ao conferir um documento no original, corrija os campos dele em `data/reading-gold.json` e marque `"conferido": true`. As entradas não conferidas apenas detectam mudanças; só as conferidas medem acerto real.

## Fontes, validação e recuperação local

- A tabela distingue documento de origem não enviado/identificado, origem desconhecida, anexo ilegível/parcial e campo não localizado. Um anexo genérico ou inacessível não é declarado ausente. O GLPI continua sendo a referência solicitada, nunca um substituto para o texto lido.
- PDFs têm duas etapas: camada digital de todas as páginas e depois OCR por página. Logos/máscaras pequenos não substituem a camada digital. Paddle/OpenCV é usado primeiro nas páginas digitalizadas; Tesseract complementa leituras fracas. Cada página tem orçamento limitado, e páginas pendentes continuam sinalizadas. Nenhum timeout vira aprovação automática.
- Páginas cujo OCR terminou ficam no cache local mesmo quando outra página ultrapassa o prazo do arquivo. Uma releitura pode retomá-las sem refazer esse OCR. O processamento agenda até três tentativas de recuperar leituras parciais por chamado/versão do leitor, com intervalo mínimo de dez minutos; não há aprovação automática nem repetição ilimitada.
- Cláusulas explícitas de representante, administrador ou procurador fornecem nome e CPF. Uma lista de sócios, isoladamente, não define o representante. CPF/CNPJ, datas, percentuais e totais explícitos são verificados; divergências de titularidade e de cidade/UF para o mesmo CEP exigem conferência. Não há consulta geográfica externa nem presunção sobre juros/entrada.
- Confirmações de campo e de leitura completa registram automaticamente os valores observados no original em `reading_gold_fields`, com hash dos bytes, autor, versão da extração e evidência. A transcrição pode ser corrigida na tela com trecho e confirmação explícita. Correções do contrato a gerar não são usadas como gabarito do original.
- `reading:benchmark` incorpora esse gabarito por campo e informa acerto humano separadamente de mudanças contra a referência antiga. Confirmar um campo não torna todo o documento um gabarito verificado. Nenhum treinamento automático de modelo é realizado.
- `npx tsx server/reading-improvement-audit.ts` audita campos e causas sem modificar a base.
- `npx tsx server/recover-reading.ts --apply` cria backup verificado, tenta recuperar PDFs pela camada digital e identifica representantes em cláusulas existentes. `--ocr-partial` relê PDFs parciais pelo novo leitor. Leituras conferidas por humanos não são substituídas; perda de campos ou edição concorrente impede a substituição automática. O relatório fica em `data/reading-recovery-report.json`.
- Consultas cadastrais externas e modelos de visão em nuvem não foram adicionados. Os documentos e o gabarito permanecem locais.

### Política vigente em 28/10/2026

Substitui os limites de 20 arquivos/2 minutos acima: reciclagem após 5 arquivos ou RSS observado de 256 MiB; encerramento ocioso em 15 s; novas leituras pesadas adiadas abaixo de 512 MiB livres. Uma trava de arquivo compartilhada serializa API e ferramentas locais. Mudança de versão não agenda releitura de extrações saudáveis. Recuperação automática limita-se a falha, parcial ou ausência de campos, preservando resultados anteriores em falhas transitórias.

O relatório de benchmark registra queueMs, readMs, shutdownMs e totalMs por arquivo. Em OCR, coincidência com GLPI só permite confirmação automática de CPF/CNPJ válido com papel explícito, página e trecho do original. Outros campos OCR continuam sujeitos à conferência humana; a camada digital e revisões humanas mantêm sua própria evidência.

### Recuperação por campo e PDFs longos

PDFs aceitam até 200 páginas; cada tentativa conclui páginas com orçamento útil (35 s; até 70 s para blocos cadastrais), respeitando o prazo global. Páginas concluídas são reutilizadas. A fila permite continuar enquanto há progresso real e esgota após três tentativas consecutivas sem progresso. Contagem de páginas, posição e trecho são usados na evidência individual; concordância de OCR sem rótulo/associação suficiente não libera o campo.

Cartões CNPJ em PDF podem receber OCR de faixas ampliadas, com confiança por campo quando há leituras concordantes. Um arquivo completo não continua em revisão genérica quando todos os campos solicitados que fornece já têm comprovação; parcialidade e decisões permanecem separadas. Medição operacional e causas restantes: data/resultado-conferencia-2026-10-28.md.
