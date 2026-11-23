# Orientações documentais do projeto Kedu

Para leitura de documentos, análise de anexos ou tratamento de
arquivos aguardando análise, consultar as skills pertinentes:

- .agents/skills/kedu-triagem-documental/SKILL.md
  Inventário, prioridades, causas das pendências e medição da fila.
- .agents/skills/kedu-leitura-precisa/SKILL.md
  Leitura multiformato com evidência, entidade e cobertura.
- .agents/skills/kedu-conferencia-documental/SKILL.md
  Comparação com GLPI e distinção entre divergência e leitura inconclusiva.

A skill .agents/skills/leitura-documentos/SKILL.md permanece preservada.

Não copiar valores esperados do GLPI para os valores extraídos.
Não declarar leitura completa sem verificar a cobertura necessária.
Não reduzir a fila apagando arquivos, omitindo pendências ou aprovando
campos sem evidência.

## Regras do projeto que valem para qualquer agente

- Não existe área "Tipo a confirmar". Toda demanda vai para uma área real
  (Aguardando elaboração do contrato, Contrato não lido, Contrato não
  encontrado, Consulta ao GLPI incompleta ou a conferência) e cita os
  anexos ainda não identificados.
- Só contrato preenchido é comparado com o GLPI. Modelo em branco
  ({{...}}) e documentos de apoio não entram na tabela de conferência.
- Os documentos são analisados como foram enviados; nunca propor pedir
  ao cliente que reenvie arquivos para facilitar a leitura.
- Ao mudar uma regra de conferência, trocar a etiqueta de versão em
  fingerprint() de server/contract-processing.ts; sem isso as demandas
  abertas não são recalculadas.
- Produção usa Supabase (KEDU_DATABASE=postgres, esquema kedu_migration).
  O .env local aponta para o SQLite antigo: para medir produção, conectar
  direto no Supabase. Contar áreas só com chamados abertos no GLPI
  (status diferente de 5 e 6).
- Gemini fica desativado: não chamar APIs pagas nem enviar documentos
  reais a serviços externos sem autorização da empresa (LGPD).
- Commits e pull requests sem menção a IA e sem linhas de coautoria.
  Nunca alterar a branch main; a branch principal é migracao-supabase.

Estas orientações não autorizam alterações no banco, nos chamados,
nos originais, nos status ou nas aprovações. Aplicações no fluxo real
dependem de autorização específica e das validações do sistema.

Guia de uso: docs/skills-documentais-kedu.md.
