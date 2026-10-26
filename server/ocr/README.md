# Leitura local de imagens

O leitor mantém texto e tabelas nativos de PDF, DOCX, DOC, ODT, PPTX, XLSX, TXT e CSV. Fotos, páginas escaneadas e imagens incorporadas compatíveis passam por OCR local. O conteúdo identifica formatos conhecidos mesmo quando a extensão está incorreta; um arquivo `.img` desconhecido não é presumido imagem.

## Preparação no Windows

Use Python 3.12 de 64 bits (aceita 3.9 a 3.13). Na raiz do projeto:

```powershell
powershell -File server/ocr/setup.ps1 -Python 'C:\caminho\python.exe'
```

O script cria `data/ocr-venv`, instala as versões de `requirements.txt`, baixa modelos oficiais em `data/ocr-models`, executa inferência de teste e só então grava `data/ocr-runtime.json`. Esses arquivos são locais e ignorados pelo Git. O ambiente principal do computador não é alterado.

PaddlePaddle 3.2.2 foi fixado porque a versão 3.3.1 apresentou incompatibilidade de oneDNN no Windows durante os testes. Os modelos usados são PP-OCRv5 mobile de detecção, reconhecimento latino e classificação de orientação. A inferência roda na CPU e não envia documentos à nuvem.

## Funcionamento

- OpenCV reduz sombras, aplica contraste local e corrige perspectiva apenas quando encontra uma borda de página suficientemente ampla. Mantém uma leitura independente da imagem original.
- PaddleOCR lê original e imagem preparada. Tesseract e a leitura por blocos continuam como fontes alternativas.
- Campos novos precisam concordar nas duas versões; conflitos com a leitura anterior permanecem visíveis. Confirmação automática exige evidência de alta confiança e comparação com o GLPI.
- Texto digital mantém origem própria. Cálculos de planilhas, decisões jurídicas, documentos incompletos e condições de contrapropostas continuam com controles separados.
- Se o motor adicional falhar ou exceder seu limite de tempo, preserva a leitura alternativa e informa a falha. O processo externo tem limite de tempo e acompanha a vida do leitor pai no Windows.

Defina `OCR_ENGINE=legacy` para desativar o motor adicional. Testes unitários não carregam modelos por padrão; testes reais podem definir `OCR_ENGINE=paddle`. Para instalação em outro computador/servidor, execute novamente o setup; não copie credenciais ou documentos para o repositório.

Imagens pequenas decorativas em arquivos Office não disparam OCR. Imagens grandes ilegíveis exigem conferência; DOC binário antigo não oferece o mesmo suporte a imagens incorporadas do DOCX. Formatos não suportados precisam de uma cópia acessível, sem apenas renomear sua extensão.
