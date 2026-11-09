# Decisão: banco de dados do Kedu (09/11/2026)

## Decisão

O banco continua em SQLite, num servidor sempre ligado, com backups automáticos, retenção, cópia externa diária e teste de restauração. A migração para o Supabase fica adiada até haver aprovação de LGPD e uma necessidade concreta.

## Contexto

O problema a resolver era o Kedu só funcionar com o computador de uma pessoa ligado. Quem resolve isso é o servidor sempre ligado (ver `docs/implantacao-servidor-checklist.md`), não a troca de banco. A equipe acessa um único servidor pelo navegador.

Medição do código em 09/11/2026:

| Medida | Quantidade |
|---|---|
| Consultas ao banco no servidor | Cerca de 500, em 43 arquivos |
| Transações com reserva de numeração e controle de concorrência | 35 |
| Tabelas / gatilhos | 45 / 17 |
| Arquivos guardados dentro do banco | 1.221, cerca de 532 MB |

O código consulta o banco de forma síncrona, que é o modo do SQLite no Node. O PostgreSQL do Supabase responde de forma assíncrona. A migração exige reescrever a camada de dados ou criar uma ponte síncrona, além de levar os arquivos para o Storage. Estimativa: 2 a 4 semanas com testes.

## Opções avaliadas

| Opção | Prazo | Risco | Resultado |
|---|---|---|---|
| A. SQLite no servidor, com backup externo | Já pronto | Baixo | **Escolhida** |
| B. Arquivos no Supabase Storage, banco em SQLite | Cerca de 1 semana | Médio | Adiada |
| C. Migração completa para o Supabase | 2 a 4 semanas | Alto | Adiada |

## Consequências

- Um único servidor por banco: o sistema já bloqueia duas APIs no mesmo arquivo.
- Proteção contra perda do servidor depende da cópia externa (`BACKUP_COPY_DIR`) estar em outro disco ou local.
- `npm run production:check` não exige mais o Supabase; só valida a configuração se ela for informada.
- `npm run db:verify-backup` testa a restauração de um backup sem tocar no banco em uso. Em 09/11/2026, o backup de 12:59 (589 MB) passou: integridade ok, 162 demandas e 1.219 arquivos.

## Quando reavaliar

Reabrir a decisão quando ocorrer qualquer um destes pontos:

- aprovação de LGPD para nuvem, com região e contrato de tratamento de dados;
- necessidade de mais de um servidor ao mesmo tempo;
- outro sistema precisar ler ou gravar diretamente no banco;
- o banco passar de alguns GB ou os backups ficarem lentos.

## Como seguir se for aprovado

1. Testar em PostgreSQL local, no Docker e fora do horário da fila, sem dados reais.
2. Começar pela opção B (arquivos no Storage privado), que reduz o banco e tem menor risco.
3. Portar a camada de dados e as 35 transações, com testes de concorrência e de numeração.
4. Migrar primeiro para um projeto de homologação, a partir de um backup verificado.
5. Fazer a troca planejada, com possibilidade de voltar ao SQLite.
