# Publicação na Vercel

O portal se divide em dois papéis com o mesmo código:

- **API e telas na Vercel** (`KEDU_ROLE=api`): `vercel.json` publica `dist/` como site estático e `api/index.ts` como função na região **`yul1` (Montréal)**, a mesma do Supabase (`ca-central-1`). Cada consulta ao banco leva cerca de 1 ms; deste computador, leva cerca de 125 ms.
- **Trabalhador** (`npm run worker`, `KEDU_ROLE=worker`): sincronização do GLPI nos horários configurados e leitura de documentos (OCR). Não atende HTTP. Precisa de Python/PaddleOCR, por isso roda fora das funções comuns: num [Vercel Daemon](https://vercel.com/docs/daemons) (beta) com a imagem do `Dockerfile`, ou numa máquina sempre ligada. A fila fica no banco, com trava, então só um trabalhador processa cada leitura.

Sem `KEDU_ROLE`, o portal continua como hoje: um único processo faz tudo (`npm start`).

## Variáveis de ambiente

Configure no projeto da Vercel (API) e no trabalhador. Nunca em variáveis `VITE_*`.

| Variável | API | Trabalhador | Valor |
|---|---|---|---|
| `KEDU_ROLE` | `api` | (definido por `npm run worker`) | |
| `KEDU_DATABASE` | `postgres` | `postgres` | |
| `KEDU_PG_SCHEMA` | sim | sim | esquema importado, por exemplo `kedu` |
| `SUPABASE_URL`, `SUPABASE_DATABASE_URL` | sim | sim | conexão do Session pooler |
| `SUPABASE_CA_CERT` | sim | ou `SUPABASE_CA_PATH` | conteúdo PEM do certificado (`\n` escapado é aceito) |
| `SUPABASE_SECRET_KEY`, `SUPABASE_STORAGE_BUCKET` | sim | sim | Storage privado dos anexos |
| `GLPI_*` | se usar rotas que consultam o GLPI | sim | como no `.env` atual |
| `GLPI_SYNC_TIMES` | vazio | `07:00,12:00,16:00` | o agendamento só roda no trabalhador |

Use Node.js 24 no projeto (o portal usa `node:sqlite`).

## Arquivos grandes

Funções da Vercel respondem até 4,5 MB. Anexos lidos acima de 4 MB saem por link temporário e privado do Storage (5 minutos), gerado só depois da verificação de acesso: download com o nome original e PDF/imagem abertos no navegador. `scripts/storage-upload.ts <pasta> --refresh-large` regrava os anexos grandes já enviados com o tipo correto.

## Antes de publicar

1. Gerar snapshot (`npm run migration:prepare`), enviar anexos (`scripts/storage-upload.ts`) e importar (`scripts/postgres-rehearsal.ts <pasta> --stage-supabase`); renomear o esquema `kedu_migration` para o valor de `KEDU_PG_SCHEMA`.
2. Todos precisam entrar de novo: as sessões não são migradas.

## Ainda pendente

- **Leitura dentro da requisição**: releitura (`/processing/recheck`), OCR de região selecionada e correção com envio de arquivo executam a leitura na própria requisição. Na função da Vercel não há PaddleOCR e o tempo é limitado; dependem de onde o OCR vai rodar.
- **Envios acima de 4,5 MB** (documento assinado até 8 MB, correção até 20 MB) ultrapassam o limite de requisição; precisam ir direto ao Storage.
- Documentos gerados e assinados continuam guardados no banco (`documents`); hoje não há nenhum.
