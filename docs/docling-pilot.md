# Leitor complementar de PDFs: Docling

O leitor principal e o OCR permanecem disponíveis. O Docling é um complemento
local para organizar texto e tabelas de **uma página de PDF por execução**.
Não recebe os valores esperados do GLPI, não envia documentos a serviços externos
e não confirma campos automaticamente.

## Controles

- Ambiente Python separado: `data/docling-venv`.
- Configuração e modelos locais: `data/docling-runtime.json` e `data/docling-models`.
- Ativação automática: `DOCUMENT_DOCLING_ENABLED=true`, somente após o piloto.
- Compartilha a trava de leitura com OCR e ferramentas de medição.
- Exige pelo menos 1,5 GB livres antes de iniciar, usa CPU com duas threads e tem
  limite de 90 segundos por página (máximo de configuração: 120 segundos).
- O processo é interrompido se a memória livre do Windows cair abaixo de 512 MB.
- Sem OCR próprio: fotos/PDFs sem texto continuam no PaddleOCR/Tesseract.
- Resultados são limitados aos campos pendentes. Valores divergentes já extraídos
  e confirmações humanas são preservados.
- A assinatura de tentativa distingue Docling de OCR, evitando repetição ilimitada.

## Medição

O piloto deve registrar arquivo/página, campos anteriores e recuperados, trecho de
origem, duração e falhas. A leitura não deve ser ativada para toda a base apenas
porque o software foi instalado. Compare com o mesmo original e valide os novos
valores antes de aplicar resultados na base.

Referência: https://docling-project.github.io/docling/usage/advanced_options/

## Piloto inicial — 03/11/2026

- Docling 2.146.0 instalado isoladamente; dependências verificadas com `pip check`.
- Cartão RH.pdf, página 2: nenhum campo recuperado. A página não possui caracteres
  nativos (confirmado com PDFium); continua dependendo de OCR. O complemento passa
  a detectar esse caso antes de carregar os modelos.
- Contrato de renovação da Escola Luz do Saber, página 1: leitura estruturada
  concluída. A razão social foi extraída, mas difere da referência do chamado.
  Não houve confirmação humana nem atualização do banco por este teste.
- Os relatórios completos permanecem em `data/docling-pilot/`.
- A ativação automática permanece desativada até medir a integração desses campos
  com a seleção da parte contratual e o consumo de memória em mais arquivos.

## Lote aplicado — 03/11/2026

Examinadas 115 demandas GLPI: 24 tinham PDFs elegíveis para o complemento.
Foram processados 26 arquivos e 81 páginas, uma por vez, com backup anterior e
comparação controlada na mesma cópia do banco. Nenhum resultado foi descartado
por conflito com alterações durante o lote. Confirmações humanas e leituras
anteriores válidas foram preservadas.

- Campos que conferem: 241 → 247; não localizados: 117 → 115; a conferir: 97 → 92.
- Divergências identificadas: 9 → 10. Recuperar um campo também pode revelar erro.
- Aguardando análise: 72 → 71; Sem erros: 36 → 37; correção: 7 → 7.
- GLPI #2026102435 passou a Sem erros.
- Duas das três páginas com falha funcionaram na repetição; uma atingiu 120 s.
- 13 testes específicos e build passaram. A fila automática foi retomada;
  a habilitação global do Docling permanece desativada.

Relatório detalhado: `data/docling-batches/2026-11-03T19-15-54-749Z/Resultado_Docling.md`.
Os ganhos acima são do lote controlado; outros processamentos da fila podem mudar
os totais exibidos posteriormente no painel.
