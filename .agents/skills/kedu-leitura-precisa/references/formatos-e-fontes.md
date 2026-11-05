# Formatos e documentos de origem

## Escolha do leitor

Confirmar as capacidades na implementação disponível; não prometer suporte universal.

- PDF digital: ler camada de texto por página e verificar ordem de leitura/tabelas. PDF misto: manter páginas digitais e usar OCR nas imagens. PDF digitalizado: renderizar e conferir orientação, resolução e regiões. Camada vazia não prova documento vazio. Registrar páginas totais, concluídas e pendentes.
- Imagens PNG/JPG/JPEG/WebP/GIF/BMP/TIF/TIFF: orientação, rotação, quadros/páginas e recortes. A visão pode examinar só o primeiro quadro; não considerar TIFF/GIF inteiro sem verificar. Nunca recortar o original destrutivamente.
- DOCX: parágrafos e tabelas, marcadores, conteúdo de imagens, cabeçalho/rodapé e alterações controladas quando acessíveis. Texto extraído não fornece paginação Word estável; citar seção/tabela/parágrafo. Controles, objetos ou alterações rejeitados permanecem bloqueados, sem removê-los para conseguir aprovação.
- DOC: o leitor integrado da aplicação pode oferecer suporte, mas o MCP local atual não inclui .doc no SUPPORTED. Usar leitor autorizado existente ou conversão local em cópia, verificando a fidelidade; não renomear para .docx.
- XLSX: inventariar abas (inclusive ocultas), linhas/colunas, fórmulas e valores em cache. Citar aba e célula/faixa. Valor em cache pode estar desatualizado; não afirmar que executou cálculo. Fórmula, célula vazia, zero e texto são diferentes. Carregar microsoft-office/references/excel.md ao extrair diretamente por ferramentas Office.
- PPTX: slides, tabelas, imagens e notas relevantes; citar slide/objeto. Não chamar extração de XML de conferência visual de todas as imagens.
- ODT: texto e tabelas com seção/parágrafo; paginação pode não existir. Imagens embutidas precisam de inspeção específica.
- TXT/CSV: confirmar codificação, delimitador, cabeçalhos, aspas e linhas. Preservar zeros de identificadores e strings de datas. Não executar fórmulas ao exportar CSV. Citar linha/coluna ou registro.
- Extensão desconhecida, arquivo protegido, truncado ou acima do limite: explicar bloqueio e solicitar versão acessível; não fabricar extração.

Para extração direta de PDF/Office carregar a skill do formato e sua referência pertinente. No MCP atual o limite é 20 MB por arquivo, até seis páginas PDF por chamada e corte de texto de 60.000 caracteres. Esses limites não são os limites universais do motor integrado. Confirmar código/schema atual. Persistir progresso fora dos originais.

## Fonte provável por campo (não exclusividade)

- Razão social/CNPJ/nome fantasia: qualificação contratual e documento cadastral, distinguindo cada rótulo. Alvará e cabeçalho comercial podem mostrar fantasia; preservar dúvida.
- Endereço/CEP/cidade/UF: sede explicitamente declarada ou cartão cadastral, não endereço do sócio, banco, foro ou Kedu.
- Representante/CPF/poderes: cláusula societária ou procuração com validade/limites/atuação conjunta. Não inventar conferência jurídica ou situação cadastral atual por documento antigo.
- Banco/agência/conta/titular/CPF-CNPJ do titular: comprovante ou declaração com bloco explícito e conta correspondente. Transferência: isolar recebedor do pagador; saudação do aplicativo não comprova titular.
- Taxa/remuneração/repasse/cashback: cláusula/proposta aplicável e unidade explícita. Não misturar valor monetário e percentual ou confundir taxa bancária com taxa contratual.
- Quantidade/total/parcelas: tabela e cláusula correspondente; incluir moeda, quantidade, periodicidade e vencimentos. Se produto divergir do total explícito, registrar conflito; calcular via ferramenta sem sobrescrever o literal.
- Vigência/início/fim: cláusulas e aditivos posteriores. Mês/ano não autoriza inventar o dia. Data de assinatura não é necessariamente início de vigência.
- Número de aditivo/matriz: histórico assinado e vínculo comprovado no sistema. Nome do arquivo ou rascunho não confirma sequência assinada.

## Suficiência

Confiança informada pelo OCR é metadado, não prova absoluta. Regras automáticas atuais devem ser conferidas em `server/comparison-evidence.ts`, `server/contract-processing.ts` e módulos por campo. Não criar política paralela mais permissiva por esta skill. Documento de apoio pode comprovar campo, mas não substitui instrumento contratual exigido. Campo digital comprovado numa página pode ser útil mesmo com outra página pendente; a pendência documental global permanece.
