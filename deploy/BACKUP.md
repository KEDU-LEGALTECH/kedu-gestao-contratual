# Backup do banco de produção

O plano gratuito do Supabase não guarda backups. O workflow `.github/workflows/backup-banco.yml` copia todo dia, às 03h30 de Brasília, o esquema do portal (`KEDU_PG_SCHEMA`) com `pg_dump`. Antes de guardar, ele confere se a cópia pode ser lida por `pg_restore` e criptografa o arquivo com AES-256 (`gpg`). O arquivo fica 14 dias como artefato privado da execução no GitHub.

Os anexos ficam no Storage do Supabase e não entram no backup: os originais continuam no GLPI e são baixados de novo pela leitura.

## Ativar

1. Gere uma frase-senha com pelo menos 24 caracteres e guarde num gerenciador de senhas da empresa. **Sem ela, nenhum backup pode ser aberto.**
2. No ambiente `kedu-ocr` do GitHub (Settings → Environments), crie o segredo `KEDU_BACKUP_PASSPHRASE` com essa frase. O ambiente já tem `SUPABASE_DATABASE_URL`, `SUPABASE_CA_CERT` e `KEDU_PG_SCHEMA`.
3. Em Settings → Secrets and variables → Actions → Variables, crie `KEDU_BACKUP_ENABLED` = `true`.
4. Rode uma vez à mão: Actions → "Backup diário do banco" → Run workflow. O resumo da execução mostra o nome do arquivo, o número de tabelas e o tamanho.

## Restaurar

Restaure sempre numa cópia separada para conferir antes. Não restaure por cima do esquema em uso.

1. Na execução desejada, baixe o artefato `backup-banco-<número>` e extraia o `.gpg`.
2. Descriptografe: `gpg --decrypt --output kedu.dump kedu-AAAA-MM-DDTHHMMZ.dump.gpg` (pede a frase-senha).
3. Confira o conteúdo: `pg_restore --list kedu.dump`.
4. Restaure num banco ou esquema de teste: `pg_restore --no-owner --no-privileges --dbname="<conexão do banco de teste>" kedu.dump`. O esquema volta com o mesmo nome (`kedu_migration`), por isso o destino precisa ser um banco onde esse esquema não exista.
5. Para trocar a produção, combine uma janela sem uso. Pause os agendamentos (`deploy/supabase-cron.sql`), restaure e retome.
