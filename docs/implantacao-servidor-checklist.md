# Kedu em servidor sempre ligado — checklist para o TI

Hoje o Kedu roda no computador de uma pessoa. Quando ele suspende ou perde a rede, param a sincronização com o GLPI, a leitura dos documentos e a conferência. De 06/11 19:56 a 09/11 10:30 nada rodou por esse motivo.

O objetivo é um único servidor sempre ligado, acessado pela equipe pelo navegador. Não deve haver uma cópia do Kedu em cada computador: o sistema bloqueia duas APIs no mesmo banco para evitar dados corrompidos.

## Arquitetura

| Parte | Onde roda |
|---|---|
| API, fila de leitura, OCR e sincronização com o GLPI | Servidor com Docker, sempre ligado |
| Banco e arquivos | Hoje SQLite em volume persistente no servidor; depois Supabase, quando aprovado |
| Acesso da equipe | Navegador, por endereço HTTPS, com login individual |

O Supabase não substitui o servidor: o OCR (PaddleOCR/Tesseract) precisa de CPU e memória num processo próprio.

## 1. Servidor

| Item | Mínimo sugerido | Por quê |
|---|---|---|
| Sistema | Linux x86-64 com Docker e Docker Compose v2 | A imagem é Linux; PaddleOCR não tem pacote para ARM |
| CPU | 4 vCPU | OCR de páginas digitalizadas é pesado e roda um arquivo por vez |
| Memória | 8 GB | API, leitor e OCR somam cerca de 1,5 a 2 GB em uso normal; abaixo de 512 MB livres o leitor adia leituras |
| Disco | 100 GB, SSD | Banco de cerca de 400 MB e crescendo, anexos dentro do banco e backups de cerca de 400 MB cada |
| Disponibilidade | Sem suspensão automática; reinício automático do Docker | A sincronização roda 07:00, 12:00 e 16:00 (Brasília) e a fila roda continuamente |

Opções: servidor ou VM da empresa, ou VM em nuvem. As duas funcionam se a rede abaixo for atendida.

## 2. Rede

- **Saída para o GLPI:** HTTPS (443) até `helpdesk.kedu.com.br`. Em 09/11 o nome resolveu para um endereço público e o acesso funcionou a partir de fora da rede interna. Se o GLPI ou o App-Token limitarem os IPs aceitos, liberar o IP do servidor.
- **Entrada para a equipe:** portas 80 e 443 abertas para o domínio do Kedu. O certificado HTTPS é emitido automaticamente pelo Caddy (`deploy/Caddyfile`).
- **Saída para baixar modelos de OCR:** necessária só na primeira inicialização.

Para confirmar, rode no servidor candidato, com o `.env.production` configurado:

```bash
docker compose --env-file .env.production -f compose.production.yaml run --rm app npm run glpi:check
```

O comando só lê: abre uma sessão no GLPI, confere grupos e um vínculo de chamado e encerra a sessão. Não grava nada nem mostra tokens. A resposta "esta máquina consegue sincronizar com o GLPI" libera o servidor.

## 3. Domínio, contas e segredos

- Domínio HTTPS para o Kedu (por exemplo, `contratos.dominio.com.br`) apontando para o servidor.
- Tokens do GLPI (App-Token e User-Token só de leitura) e, depois, as credenciais do Supabase entregues por canal de segredos da empresa. Nunca por chat, e-mail comum ou Git.
- Lista das pessoas que usarão o Kedu e seus perfis (Administrador, Operação, Risco, Jurídico, Financeiro, Consulta).

## 4. Backups

- O servidor faz um backup verificado ao iniciar e a cada 6 horas.
- Definir quantos backups manter no servidor e uma cópia externa diária. Cópia no mesmo disco não protege contra perda do servidor.
- Indicar o destino da cópia externa diária (`BACKUP_COPY_DIR`): outro disco ou pasta de rede montada no servidor.
- Testar uma restauração antes de usar em produção: `npm run db:verify-backup` abre uma cópia do backup e confere integridade e contagens, sem tocar no banco em uso.

## 5. LGPD e Supabase (decisão da empresa)

Os documentos contêm dados pessoais e bancários. Antes de levar banco e arquivos para o Supabase:

- Aprovação do encarregado de dados (DPO) e do Jurídico.
- Região do projeto (preferência por São Paulo, `sa-east-1`).
- Contrato de tratamento de dados com o fornecedor.
- Bucket de arquivos privado e credencial de servidor de menor privilégio.

Até essa aprovação, o Kedu continua com SQLite no servidor e nenhum dado vai para o Supabase.

Decisão registrada em `docs/decisao-banco-de-dados.md`: o banco fica em SQLite no servidor; o Supabase será reavaliado depois da aprovação.

## 6. Sequência de implantação

1. TI disponibiliza servidor, domínio e segredos.
2. `glpi:check` no servidor responde que consegue sincronizar.
3. `npm run production:check` lista o que ainda falta, sem mostrar senhas.
4. Criar o administrador real com `npm run admin:prepare` e as contas da equipe.
5. Transferir o banco atual a partir de um backup verificado, com o Kedu parado no computador de origem.
6. Iniciar o servidor, conferir login, uma sincronização e uma leitura.
7. Desligar definitivamente o Kedu do computador pessoal.

## Responsáveis

| Item | Quem |
|---|---|
| Servidor, rede, domínio e certificados | TI |
| Segredos do GLPI e do Supabase | TI |
| Aprovação de LGPD e da nuvem | DPO e Jurídico |
| Lista de usuários e perfis | Gestão do Jurídico |
| Homologação dos modelos de contrato | Jurídico |
