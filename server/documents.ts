import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { addendumFields, previousKey } from "../shared/request-policy.js";
import {officialInputs} from '../shared/official-fields.js';
import {structuredProfile,generateStructured,reviewStructured} from './structured-docx.js';
export const fixed =
  "MODELO DE DEMONSTRAÇÃO — SEM APROVAÇÃO JURÍDICA. Este documento contém somente dados fictícios para validação do fluxo operacional. Não constitui instrumento contratual.";
export const fields = [
  "cnpj",
  "razaoSocial",
  "remuneracao",
  "garantia",
  "repasse",
  "cashback",
  "valor",
  "banco",
  "agencia",
  "conta",
  "inicio",
  "fim",
  "dataRepasse",
  "modalidade",
  "matriz",
  "aditivo",
  "endereco",
  "dataAssinaturaMatriz",
  "dataFormalizacao",
  "localidade",
  "cnpjSolidario",
  "titularConta",
  "documentoTitular",
  "pix",
  "motivo",
  "referenciaAnterior",
  "cashbackValor",
  ...Array.from(new Set(Object.values(addendumFields).flat())).map(previousKey),
  ...Object.keys(officialInputs),
];
const esc = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
/** binaryLimit: received attachments may embed fonts and images beyond the 20 MB text limit;
 * those parts get their own limit and must not expand like a ZIP bomb. Templates keep the strict default. */
export function preflight(bytes: Buffer, binaryLimit = 0) {
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw Error("ZIP inválido");
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16),
    total = 0,
    binary = 0;
  if (count > 512) throw Error("Muitos componentes DOCX");
  for (let n = 0; n < count; n++) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50)
      throw Error("Diretório ZIP inválido");
    const compressed = bytes.readUInt32LE(offset + 20),
      size = bytes.readUInt32LE(offset + 24);
    const length = bytes.readUInt16LE(offset + 28),
      extra = bytes.readUInt16LE(offset + 30),
      comment = bytes.readUInt16LE(offset + 32);
    const name = bytes.subarray(offset + 46, offset + 46 + length).toString();
    if (binaryLimit && /^word\/(?:fonts|media)\//.test(name)) {
      binary += size;
      if (binary > binaryLimit || size > 100 * compressed + 1_000_000)
        throw Error("DOCX descompactado excede 20 MB");
    } else {
      total += size;
      if (total > 20_000_000) throw Error("DOCX descompactado excede 20 MB");
    }
    if (name.includes("..") || name.startsWith("/") || name.includes("\\"))
      throw Error("Caminho de arquivo inválido");
    offset += 46 + length + extra + comment;
  }
}
export function demoTemplate(label = "") {
  const zip = new PizZip();
  zip.file(
    "[Content_Types].xml",
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    "word/document.xml",
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>${esc(fixed)}</w:t></w:r></w:p>${label ? `<w:p><w:r><w:t>${esc(label)} — quadro resumo demonstrativo</w:t></w:r></w:p>` : ""}${fields.map((f) => `<w:p><w:r><w:t>${f}: {${f}}</w:t></w:r></w:p>`).join("")}<w:sectPr/></w:body></w:document>`,
  );
  return zip.generate({ type: "nodebuffer" });
}
export function paragraphs(bytes: Buffer) {
  preflight(bytes);
  const zip = new PizZip(bytes);
  let size = 0;
  for (const f of Object.values(zip.files)) {
    if (!f.dir) {
      size += f.asUint8Array().length;
      if (size > 20_000_000) throw Error("DOCX descompactado excede 20 MB");
    }
    if (
      /vbaProject|embeddings|activeX|word\/(header|footer|footnotes|endnotes)/i.test(
        f.name,
      )
    )
      throw Error("Conteúdo ativo não permitido");
    if (f.name.endsWith(".rels") && /TargetMode="External"/i.test(f.asText()))
      throw Error("Relacionamentos externos não permitidos");
  }
  const xml = zip.file("word/document.xml")?.asText();
  if (
    !xml ||
    /<!DOCTYPE|<!ENTITY|<w:altChunk|<w:instrText|<w:del[ >]|<w:ins[ >]|<w:drawing|<w:object|<w:pict/.test(
      xml,
    )
  )
    throw Error("Estrutura DOCX não suportada");
  return (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || [])
    .map((p) =>
      (p.match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g) || [])
        .map((t) =>
          t
            .replace(/<[^>]+>/g, "")
            .replaceAll("&amp;", "&")
            .replaceAll("&lt;", "<")
            .replaceAll("&gt;", ">"),
        )
        .join("")
        .normalize("NFC")
        .trim(),
    )
    .filter(Boolean);
}
export function generate(template: Buffer, data: Record<string, string>) {
  paragraphs(template);
  if(structuredProfile(template)) return generateStructured(template,data);
  return new Docxtemplater(new PizZip(template), {
    paragraphLoop: true,
    linebreaks: true,
  })
    .render(
      Object.fromEntries(fields.map((f) => [f, data[f] || "Não aplicável"])),
    )
    .getZip()
    .generate({ type: "nodebuffer" });
}
export function review(
  bytes: Buffer,
  expected: Record<string, string>,
  template: Buffer,
) {
  try {
    paragraphs(bytes); paragraphs(template);
    if(structuredProfile(template)) return reviewStructured(bytes,expected,template);
    const p = paragraphs(bytes),
      baseline = paragraphs(generate(template, expected));
    const results: any[] = [];
    fields.forEach((f) => {
      const occurrences = p.filter((x) => x.startsWith(f + ": "));
      if (occurrences.length > 1)
        results.push({
          field: f,
          expected: "Uma única ocorrência do campo",
          found: occurrences.join("\n"),
          location: "Quadro de dados",
          severity: "crítica",
          guidance: "Remova campos duplicados e confira novamente.",
        });
      const i = p.findIndex((x) => x.startsWith(f + ": ")),
        found = i < 0 ? "Ausente" : p[i].slice(f.length + 2),
        want = expected[f] || "Não aplicável";
      if (found !== want)
        results.push({
          field: f,
          expected: want,
          found,
          location: `Parágrafo ${i + 1}`,
          severity: "crítica",
          guidance: "Corrija o campo e gere uma nova conferência.",
        });
    });
    const fixedP = p.filter((x) => !fields.some((f) => x.startsWith(f + ": ")));
    const fixedB = baseline.filter(
      (x) => !fields.some((f) => x.startsWith(f + ": ")),
    );
    if (JSON.stringify(fixedP) !== JSON.stringify(fixedB))
      results.push({
        field: "Corpo fixo",
        expected: fixedB.join("\n"),
        found: fixedP.join("\n"),
        location: "Corpo do documento",
        severity: "crítica",
        guidance: "Revisão jurídica obrigatória. Restaure o modelo aprovado.",
      });
    if (
      p.some((x) =>
        /\{[^}]+\}|\[(?:DADO|PREENCHER|NOME|CNPJ|VALOR|DATA)[^\]]*\]/i.test(x),
      )
    )
      results.push({
        field: "Placeholder",
        severity: "crítica",
        expected: "Preenchido",
        found: "Variável não preenchida",
        location: "Documento",
        guidance: "Preencha todas as variáveis.",
      });
    return { status: results.length ? "divergente" : "conforme", results };
  } catch {
    return {
      status: "inconclusiva",
      results: [
        {
          field: "Arquivo",
          expected: "DOCX interpretável",
          found: "Estrutura não suportada",
          severity: "crítica",
          location: "Documento",
          guidance: "Exige revisão humana e substituição do arquivo.",
        },
      ],
    };
  }
}
