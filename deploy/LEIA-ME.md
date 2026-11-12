# Preparação de publicação e Supabase

O portal continua usando SQLite. Os arquivos desta pasta preparam a implantação do backend existente; não representam migração concluída para Supabase.

## O que solicitar ao TI

1. Projeto Supabase corporativo aprovado, com responsável pela administração.
2. URL do projeto e conexão PostgreSQL do painel Connect, preferencialmente Session pooler quando houver limitação IPv6. Entregar senha e chave do servidor por canal de segredos da empresa, nunca pelo código ou navegador.
3. Bucket **privado** para documentos, nome sugerido `kedu-documentos`, e credencial exclusivamente de servidor para acessá-lo. Não colocar chave secreta em variável `VITE_*`.
4. Domínio HTTPS, servidor da aplicação (OCR e geração DOCX precisam de CPU/memória) e armazenamento persistente.
5. Responsáveis pelos usuários reais, permissões, cópia externa dos backups e restauração.

## Comandos disponíveis agora

- `npm run production:check`: mostra pendências sem exibir senhas. Código de saída 2 significa **não pronto**, não falha de importação.
- `npm run migration:prepare`: cria snapshot SQLite verificado e inventário offline de tabelas, colunas, relacionamentos, gatilhos e arquivos. Extrai blobs com hashes para futura transferência. Não envia nada ao Supabase e não converte SQL automaticamente.
- `npm run supabase:check`: após configurar o ambiente, verifica conexão PostgreSQL em transação somente leitura, TLS validado e, com credencial de Storage, se o bucket é privado. Não cria objetos, não migra registros e não muda o armazenamento do portal.
- `npm run legal:package`: exporta modelos oficiais editáveis e prévias com campos PENDENTES e aviso de não assinatura, manifesto de hashes e checklist. Não aprova versões nem registra prévias fictícias em demandas reais.
- `npm run db:backup`: backup online consistente, incluindo WAL, com integridade e referências verificadas.
- `npm run glpi:check`: confirma, em poucos segundos e só com leituras, se a máquina alcança o GLPI: nome do servidor, tokens, grupos e chamados visíveis. Use no servidor candidato antes da implantação. Não grava nada nem mostra tokens.

## OCR na imagem Docker

A imagem inclui Python e PaddleOCR (`server/ocr/requirements.txt`). Na primeira inicialização, `deploy/docker-entrypoint.sh` baixa os modelos para o volume de dados e só marca o OCR como pronto após uma inferência de teste. Isso exige saída de rede uma vez. Se falhar, o servidor sobe mesmo assim e lê imagens só com Tesseract; reinicie para tentar de novo. `OCR_ENGINE=legacy` desativa o PaddleOCR. A imagem fica grande (alguns GB) por causa do PaddlePaddle; use servidor Linux x86-64.

Checklist para o TI: [docs/implantacao-servidor-checklist.md](../docs/implantacao-servidor-checklist.md).

O pacote jurídico gerado é material para revisão, não evidência de aprovação. Nesta máquina, a renderização das prévias não foi concluída porque `soffice.exe` (LibreOffice) não está instalado. A estrutura DOCX foi gerada, mas a conferência visual no Word/Google Docs e a validação jurídica continuam pendentes. Não utilizar essas prévias para assinatura.

Os diretórios de migração e backup contêm dados internos, hashes de autenticação e possivelmente sessões no snapshot. São privados e ignorados pelo Git. Sessões estão explicitamente listadas para **não** serem migradas para a nova implantação. Não publique esses diretórios nem os envie ao Jurídico; o pacote de modelos é um artefato separado.

## Backups automáticos

`BACKUP_INTERVAL_HOURS=6` executa uma cópia ao iniciar e a cada seis horas, enquanto o servidor estiver rodando. `BACKUP_DIR` define a pasta. `last-success.json` registra a última cópia validada. Falhas são registradas no log, e uma cópia que falha não deixa arquivo `.partial`. `BACKUP_KEEP` define quantos backups automáticos manter (por exemplo, 28 = 7 dias a cada 6 horas); os mais antigos são removidos só depois de um novo backup verificado. Backups com outro nome nunca são removidos. Sem `BACKUP_KEEP`, ou com 0, todos são mantidos. Defina capacidade e retenção com o TI.

`BACKUP_COPY_DIR` ativa a cópia externa: uma vez por dia, o backup verificado mais recente é copiado para esse destino, conferido por checksum e limitado a `BACKUP_COPY_KEEP` cópias (padrão 14). Use outro disco ou uma pasta de rede montada no contêiner (veja o exemplo comentado em `compose.production.yaml`). Se a cópia falhar, o backup local é mantido e a falha aparece no log.

`npm run db:verify-backup` testa a restauração: abre uma cópia do backup mais recente numa pasta temporária, confere integridade, referências e contagens, e apaga a cópia. Use `-- --copy` para testar a cópia externa ou `-- caminho.sqlite` para um arquivo específico. Não toca no banco em uso.

Decisão sobre o banco (SQLite agora, Supabase depois): [docs/decisao-banco-de-dados.md](../docs/decisao-banco-de-dados.md). Uma cópia no mesmo computador/servidor não substitui cópia externa.

Para testar restauração, abra uma cópia do snapshot em uma pasta separada, configure `DATABASE_PATH` para essa cópia e execute as verificações em ambiente isolado, sem tokens reais do GLPI. Não sobrescreva o banco em uso. O backup é reaberto em modo somente leitura e validado automaticamente a cada execução.

## Variáveis do Supabase

Configure apenas no ambiente de servidor, conforme `production.env.example`:

- `SUPABASE_URL`: URL HTTPS do projeto.
- `SUPABASE_DATABASE_URL`: conexão com usuário/senha do mesmo projeto. TLS com verificação de certificado é obrigatório; se incluir `sslmode`, use `verify-full`.
- `SUPABASE_CA_PATH`: caminho local do certificado CA do projeto, quando necessário; em contêiner, monte o certificado somente leitura e use o caminho interno.
- `SUPABASE_SECRET_KEY`: credencial secreta do servidor para verificar Storage; sem ela, o comando informa que essa etapa não foi verificada.
- `SUPABASE_STORAGE_BUCKET`: nome do bucket privado.

O diagnóstico não aceita hosts arbitrários ou desativação de TLS. Erros de conexão são apresentados sem a URL autenticada.

## O que ainda exige implementação e validação da migração

Para verificar a cópia gerada por `migration:prepare`, execute
`npx tsx scripts/postgres-rehearsal.ts <pasta-do-manifesto> --inspect`.
Com um banco local descartável chamado `kedu_rehearsal`, informe a conexão
em `KEDU_REHEARSAL_DATABASE_URL` e use `--rehearse` para ensaiar a importação.
O ensaio cria um esquema temporário dentro de uma transação, verifica as
contagens, chaves estrangeiras e hashes dos arquivos e reverte a transação.
O banco de teste deve usar UTF-8. Os arquivos são ensaiados como `BYTEA`.
Esta etapa valida a cópia dos dados e o esquema. O runtime da API e a
integração com o Storage ainda precisam ser adaptados.

Use `--pilot-only` com o mesmo banco local para testar login, logout,
expiração da sessão, visibilidade por responsável e dados bancários
com registros fictícios. O piloto também testa criar, abrir e editar
demandas manuais de contratos, incluindo auditoria e conflito de versão.
Esse modo cria o esquema e reverte o teste ao final.

O backend usa chamadas síncronas SQLite, consultas específicas, gatilhos de imutabilidade e transações de numeração. A conexão PostgreSQL preparada não substitui essas chamadas. Antes de mudar o runtime, é necessário:

1. Portar a camada de persistência e as consultas para PostgreSQL, preservando transações e concorrência.
2. Portar as restrições e os gatilhos; definir esquema privado/RLS e menor privilégio para o servidor.
3. Migrar arquivos para Storage privado, guardar referências e preservar hashes e versões.
4. Migrar dados a partir de snapshot consistente, sem sessões ativas, verificando contagens, relacionamentos e hashes.
5. Testar perfis, acesso a documentos, edições concorrentes, numeração, reversão de transações e recuperação.
6. Validar com um projeto de homologação e uma demanda autorizada; somente então fazer a troca planejada com possibilidade de retorno.

## Implantação HTTPS preparada (não executada)

Após o TI fornecer os valores, copie o exemplo para `.env.production`, configure segredos e domínio reais e valide:

```powershell
docker compose --env-file .env.production -f compose.production.yaml config --quiet
```

O Compose prepara um backend sem porta pública direta e Caddy nas portas 80/443, com certificado automático para o domínio configurado. O aplicativo fica atrás de exatamente um proxy, usa cookies seguros em produção e volumes persistentes separados para dados e backups. O endpoint `/healthz` verifica disponibilidade sem expor dados ou exigir login.

Não execute a publicação como se a migração Supabase estivesse pronta. Para validar só a sintaxe do exemplo, sem segredos ou serviço em execução:

```powershell
docker compose --env-file deploy/production.env.example -f compose.production.yaml config --no-env-resolution --quiet
```

Um banco novo de produção precisa de administrador real provisionado com `npm run admin:prepare`; esse comando só aceita banco sem usuários e não converte automaticamente a conta demonstrativa existente. Remova a senha inicial do ambiente após o provisionamento. Não gere contas ou senhas reais sem os responsáveis definidos.

## Referências oficiais

- [Conexão PostgreSQL no Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [TLS e validação de certificados](https://supabase.com/docs/guides/platform/ssl-enforcement)
- [Buckets e acesso privado](https://supabase.com/docs/guides/storage/buckets/fundamentals)
