import { preflight } from "./documents.js";
import PizZip from "pizzip";
import { DOMParser } from "@xmldom/xmldom";
const W="http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export function contractParagraphs(bytes:Buffer) {
  preflight(bytes);
  const zip=new PizZip(bytes),lines:string[]=[];
  if(!zip.file("word/document.xml"))throw Error("Documento Word ausente.");
  for(const f of Object.values(zip.files)) {
    if(/vbaProject|embeddings|activeX/i.test(f.name))throw Error("Conteúdo ativo não suportado.");
    if(!/^word\/(?:document|header\d*|footer\d*|footnotes|endnotes)\.xml$/i.test(f.name))continue;
    const xml=f.asText();
    if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error("XML inseguro.");
    const parsed=new DOMParser({onError:()=>{throw Error("XML inválido.");}}).parseFromString(xml,"application/xml");
    for(const tag of ["ins","del","vanish","webHidden","altChunk"])
      if(parsed.getElementsByTagNameNS(W,tag).length)throw Error("Revisões ou conteúdo oculto exigem conferência manual.");
    for(const p of Array.from(parsed.getElementsByTagNameNS(W,"p"))) {
      const text=Array.from(p.getElementsByTagNameNS(W,"t")).map(t=>t.textContent||"").join("").normalize("NFC").trim();
      if(text)lines.push(text);
    }
  }
  return lines;
}

export const attachmentFields: Record<string,string> = {
  cnpj: "CNPJ da contratante", remuneracao: "Taxa de remuneração", garantia: "Percentual de garantia", repasse: "Percentual de repasse", valor: "Valor de referência",
};
const labels: Record<string,RegExp> = {
  cnpj: /\bcnpj\b/i, remuneracao: /taxa(?: de remuneracao)?|remuneracao/i,
  garantia: /percentual de garantia|garantia de|garantia:/i,
  repasse: /percentual de repasse|repasse de|repasse:/i,
  valor: /valor de referencia|valor contratual|valor:/i,
};
const normalize = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const canonical = (key:string,s:string) => key === "cnpj" ? s.replace(/\D/g, "") : String(Number(s.replace(/R\$|\s|%/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".")));

/** Bounded, deterministic field comparison. Missing and ambiguous passages never pass. */
export function inspectAttachment(bytes: Buffer, name: string, expected: Record<string,string>) {
  let lines: string[] = [];
  const findings: any[] = [];
  if (!/\.docx$/i.test(name)) return { status: "inconclusiva", text: "", findings: [{ field: "Arquivo", expected: "DOCX com texto legível", found: /\.pdf$/i.test(name) ? "PDF — leitura automática ainda não disponível" : "Imagem ou formato sem leitura automática", guidance: "Abra o original e confira manualmente. Obtenha o contrato em DOCX editável para comparar os valores; não basta renomear a extensão.", location: name }] };
  try { lines = contractParagraphs(bytes); }
  catch { return { status: "inconclusiva", text: "", findings: [{ field: "Arquivo", expected: "DOCX válido e legível", found: "Estrutura inválida ou não suportada", guidance: "Abra o documento no Word e salve uma cópia válida em DOCX.", location: name }] }; }
  for (const [key,want] of Object.entries(expected)) {
    if (!attachmentFields[key] || !want) continue;
    const candidates: {value:string;location:string}[] = [];
    lines.forEach((line,i) => {
      const plain = normalize(line), label = labels[key].exec(plain);
      if (!label) return;
      // Search only after the field label; the next line is accepted for form-style documents.
      const tail = line.slice(label.index + label[0].length);
      const nearby = tail.trim().replace(/^[:\s]+/, "") ? tail : tail + " " + (lines[i+1] || "");
      const pattern = key === "cnpj" ? /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g : key === "valor" ? /(?:R\$\s*)?\b(?:\d{1,3}(?:\.\d{3})*|\d+),\d{2}\b/g : /\b\d{1,3}(?:[,.]\d{1,2})?\s*%/g;
      for (const match of nearby.matchAll(pattern)) candidates.push({value: match[0], location: `Parágrafo ${i+1}: ${line.slice(0,280)}`});
    });
    const distinct = [...new Set(candidates.map(c=>canonical(key,c.value)))];
    if (distinct.length !== 1) findings.push({ field:key, expected:want, found:distinct.length ? candidates.map(c=>c.value).join("; ") : "Não localizado com identificação suficiente", guidance:distinct.length ? "Há mais de um valor associado ao campo. Confira a cláusula e identifique manualmente o valor vigente e o proposto antes de continuar." : "Localize o campo no contrato e confira manualmente. Um valor não localizado não é considerado correto.", location:candidates.map(c=>c.location).join("\n") || name, inconclusive:true });
    else if (distinct[0] !== canonical(key,want)) findings.push({field:key,expected:want,found:candidates[0].value,guidance:`Confira a fonte e, se o valor esperado estiver correto, altere o documento para ${want}. Salve uma nova cópia DOCX e envie para nova conferência.`,location:candidates[0].location});
    else findings.push({field:key,expected:want,found:candidates[0].value,guidance:"Valor corresponde à referência informada. A cláusula e os poderes de assinatura ainda exigem revisão humana.",location:candidates[0].location,matched:true});
  }
  if (!findings.length) findings.push({field:"Referência",expected:"Ao menos um valor esperado conferido",found:"Nenhum valor informado",guidance:"Informe os valores desejados e a fonte antes de analisar.",location:name,inconclusive:true});
  const status = findings.some(f=>!f.matched && !f.inconclusive) ? "divergente" : findings.some(f=>f.inconclusive) ? "inconclusiva" : "conforme";
  return {status,text:lines.join("\n"),findings};
}
