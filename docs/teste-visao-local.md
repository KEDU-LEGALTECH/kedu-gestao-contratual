# Piloto de visão local — Hermes e Ollama

O teste usa o Qwen3-VL 2B Instruct no Ollama, sem API paga. O serviço está restrito a `127.0.0.1:11434`. Não foram cadastradas credenciais de nuvem no perfil Hermes deste piloto.

## Instalação nesta máquina

- Ollama 0.40.13, instalado pelo pacote oficial `Ollama.Ollama`.
- Qwen3-VL `qwen3-vl:2b-instruct`, cerca de 1,9 GB. A variante inicial `qwen3-vl:2b` também foi baixada, mas não foi selecionada para o perfil final.
- Hermes Agent 0.22.5, instalado a partir do instalador oficial, sem componentes de navegador/controle do computador.
- O bootstrap do Hermes precisou usar o executável Python 3.14.9 diretamente, porque o atalho de versão criado pelo instalador não foi reconhecido. As dependências foram preparadas pelo gerenciador oficial do Hermes.

Os programas foram instalados no perfil Windows do usuário. O perfil de teste fica em `data/hermes-local-profile/config.yaml`: modelo principal e visão usam o endpoint local; nenhum fallback de nuvem foi configurado. O perfil não substitui o `.env` do projeto nem habilita a integração Gemini.

## Testar a leitura local de um anexo

Execute no terminal do projeto:

```powershell
npx tsx server/test-local-document.ts ID_DO_ARQUIVO cnpj,razaoSocial,nomeFantasia
```

O ID é o identificador interno de `processing_files`, não o número do chamado. O comando abre o banco somente para leitura e aceita um anexo de imagem. O resultado fica em `data/local-vision-tests/`. Cada observação inclui campo, valor, entidade, página e trecho declarado pelo modelo. As sugestões não são confirmações e a evidência deve ser conferida no original.

O teste não altera dados, etapas ou gabaritos das demandas. Não envia os valores esperados do GLPI ao modelo. O servidor é fixo em loopback, redirecionamentos são recusados e nomes de modelos cloud não são aceitos. O modelo é descarregado ao fim de uma chamada concluída (`keep_alive: 0`). Uma chamada interrompida pode levar algum tempo para encerrar o trabalho no servidor.

## Limites

Esta máquina tem 15,7 GB de RAM e Intel Iris Xe; a inferência usa CPU. O piloto começou com apenas cerca de 1 GB livre, depois chegou a cerca de 3,8 GB. Duas chamadas diretas à variante inicial `qwen3-vl:2b` ultrapassaram 240 segundos. A ferramenta visual do Hermes retornou em 181 segundos, mas apenas com raciocínio incompleto, sem JSON final válido. Esse resultado não é uma extração concluída. A configuração foi alterada para a variante Instruct antes da próxima medição.

Com Instruct, a ferramenta de visão do Hermes concluiu em 96 segundos no recorte superior do cartão CNPJ do chamado 2026102092. Os três valores (CNPJ, razão social e nome fantasia) e seus trechos foram conferidos visualmente no original e estavam corretos. O modelo devolveu `page` como string e variou `entity` entre razão social e fantasia; a validação estrita de metadados recusou a resposta. Portanto, o ganho demonstrado é a leitura visual de 3/3 valores nesse recorte, e não aprovação automática ou melhora comprovada sobre o OCR atual, que já possui esses valores. O original e as etapas permaneceram intactos.

A chamada direta estruturada com Instruct concluiu em 72 segundos: 3 valores corretos, sem repetição de campos, página numérica e trechos contendo os valores. Porém, `entity` veio preenchido com rótulos dos campos, não com a empresa. O leitor agora emite avisos específicos para esse caso e mantém `automaticApproval: false`. A associação à entidade precisa ser aprimorada antes de qualquer uso automático. O modelo foi descarregado da memória ao encerrar o piloto e a API do projeto continuou saudável.

Não execute leitura em lote ainda. É preciso medir acurácia e tempo com vários documentos, tratar recortes/paginação de PDFs e integrar o resultado validado à comparação antes de esperar redução de Aguardando análise. Instalar Hermes não melhora, por si só, o reconhecimento do modelo conectado.
