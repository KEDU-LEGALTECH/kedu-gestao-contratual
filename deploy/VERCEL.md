# Publicação na Vercel

Tudo roda na Vercel, sem máquina ligada. O portal usa a função `api/index.ts` na região **`yul1` (Montréal)**, a mesma do Supabase (`ca-central-1`): cada consulta ao banco leva cerca de 1 ms (deste computador, cerca de 125 ms). As telas (`dist/`) são publicadas como site estático.

O trabalho em segundo plano não fica rodando: o **Vercel Cron** chama duas rotas, que fazem a parte vencida e terminam.

| Rota | Agenda | O que faz |
|---|---|---|
| `/api/cron/glpi-sync` | a cada 15 min | sincroniza o GLPI quando um horário de `GLPI_SYNC_TIMES` passou sem sincronização concluída; a trava no banco impede execuções simultâneas |
| `/api/cron/reading` | a cada 5 min | retoma leituras paradas há mais de 20 min, enfileira o que falta ler e lê documentos por até `READING_CYCLE_SECONDS` (padrão 240 s) |

As rotas só respondem com o cabeçalho que a Vercel envia (`Authorization: Bearer <CRON_SECRET>`). A fila fica no banco com trava: execuções sobrepostas não leem o mesmo documento.

**Plano necessário: Pro.** No Hobby o Cron roda no máximo uma vez por dia e a função tem até 300 s; o Pro permite agenda por minuto e até 800 s (`maxDuration` em `vercel.json`).

## Leitura de documentos sem Python

Nas funções da Vercel não há PaddleOCR nem Docling (Python). Configure `OCR_ENGINE=legacy`: imagens e PDFs digitalizados usam o Tesseract.js (JavaScript) e, com `DOCUMENT_VISION_ENABLED`, a leitura por visão do Gemini. Textos digitais (PDF, DOCX, XLSX) não dependem de OCR.

## Variáveis de ambiente

Configure no projeto da Vercel. Nunca em variáveis `VITE_*`.

| Variável | Valor |
|---|---|
| `KEDU_ROLE` | `api` |
| `KEDU_DATABASE` | `postgres` |
| `KEDU_PG_SCHEMA` | esquema importado, por exemplo `kedu` |
| `SUPABASE_URL`, `SUPABASE_DATABASE_URL` | conexão do Session pooler |
| `SUPABASE_CA_CERT` | conteúdo PEM do certificado (`\n` escapado é aceito) |
| `SUPABASE_SECRET_KEY`, `SUPABASE_STORAGE_BUCKET` | Storage privado dos anexos |
| `CRON_SECRET` | valor aleatório longo; a Vercel o envia nas chamadas do Cron |
| `OCR_ENGINE` | `legacy` |
| `GLPI_*`, `GLPI_SYNC_TIMES` | como no `.env` atual (ex.: `07:00,12:00,16:00`) |
| `DOCUMENT_VISION_*`, `GEMINI_*` | como no `.env` atual |

Use Node.js 24 no projeto (o portal usa `node:sqlite`).

## Arquivos grandes

Funções da Vercel recebem e respondem até 4,5 MB por requisição.

- **Envios** (documento assinado, correção, matriz, modelos): arquivos acima de 4 MB vão do navegador direto ao Storage privado por link de envio (`POST /api/uploads`), numa pasta do usuário; a rota de sempre recebe o arquivo de lá com o mesmo limite de tamanho e o apaga. Outro usuário não consegue usar o envio, e ele não pode ser reutilizado.
- **Anexos lidos** acima de 4 MB saem por link temporário e privado do Storage (5 minutos), gerado só depois da verificação de acesso: download com o nome original e PDF/imagem abertos no navegador. `scripts/storage-upload.ts <pasta> --refresh-large` regrava os anexos grandes já enviados com o tipo correto.
- **Demais arquivos** respondidos pela API acima de 4 MB (download direto do GLPI, documento assinado, conferências, matriz) são enviados em partes (streaming), que não têm esse limite. Só na Vercel; localmente nada muda.

Na Vercel só a pasta temporária aceita escrita: o cache e a trava de leitura ficam nela automaticamente.

## Antes de publicar

1. Gerar snapshot (`npm run migration:prepare`), enviar anexos (`scripts/storage-upload.ts`) e importar (`scripts/postgres-rehearsal.ts <pasta> --stage-supabase`); renomear o esquema `kedu_migration` para o valor de `KEDU_PG_SCHEMA`.
2. Todos precisam entrar de novo: as sessões não são migradas.

## Outras formas de rodar

- `npm start` sem `KEDU_ROLE`: um processo faz tudo (como no computador atual).
- `npm run worker` (`KEDU_ROLE=worker`): só o trabalho em segundo plano, para uma máquina com PaddleOCR, se um dia for preciso.

## Ainda pendente

- Documentos gerados e assinados continuam guardados no banco (`documents`, hoje sem nenhum); se crescerem, podem ir para o Storage como os anexos.
- Nada disso foi publicado ainda: o primeiro deploy deve ser conferido numa URL de pré-visualização da Vercel antes da troca.
