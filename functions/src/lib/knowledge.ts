
// @ts-ignore
import { extractText, getDocumentProxy } from "unpdf";
import { HttpError } from "./auth-guard";
import { llmText as llm, type AiSettings } from "./openrouter";

// Limits keep every Firestore doc well under 1 MiB and the manual small enough for every prompt.
export const MAX_PDF_BYTES = 15 * 1024 * 1024;
const CHUNK_CHARS = 15_000;
const MAX_CHUNKS = 12; // ~180k chars of PDF text
export const MAX_FILE_MD = 200_000;
export const MAX_MANUAL = 60_000;

export type KnowledgeFile = { id: string; name: string; pages: number; chars: number; markdown: string };

export async function extractPdfText(bytes: Uint8Array) {
  if (Buffer.from(bytes.subarray(0, 5)).toString("latin1") !== "%PDF-") throw new HttpError(400, "El archivo no es un PDF");
  try {
    const pdf = await getDocumentProxy(bytes);
    const { totalPages, text } = await extractText(pdf, { mergePages: true });
    return { pages: totalPages, text: text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim() };
  } catch {
    throw new HttpError(400, "No se pudo leer el PDF (¿está protegido con contraseña o dañado?)");
  }
}

/** Splits text on paragraph boundaries into chunks of at most `size` chars. */
function chunk(text: string, size: number) {
  const out: string[] = [];
  let cur = "";
  for (const para of text.split(/\n\n+/)) {
    if (cur && cur.length + para.length + 2 > size) {
      out.push(cur);
      cur = "";
    }
    // A single huge paragraph is cut hard.
    for (let i = 0; i < para.length; i += size) cur += (cur ? "\n\n" : "") + para.slice(i, i + size);
  }
  if (cur) out.push(cur);
  return out;
}

const PDF_TO_MD = `Conviertes texto extraído de un PDF en Markdown limpio para que un agente de atención al cliente lo use como base de conocimiento.
Reglas:
- Conserva TODOS los datos concretos (precios, horarios, direcciones, condiciones, nombres de productos, políticas, cifras). No inventes nada ni resumas en exceso.
- Reconstruye la estructura: títulos (##, ###), listas, y tablas Markdown cuando el texto sea tabular.
- Elimina ruido de maquetación: números de página, encabezados/pies repetidos, guiones de corte de línea.
- Mantén el idioma original.
- Devuelve solo el Markdown, sin comentarios ni bloques de código envolventes.`;

/** PDF text → structured Markdown, in chunks when the document is long. */
export async function pdfToMarkdown(apiKey: string, model: string, name: string, text: string) {
  const parts = chunk(text, CHUNK_CHARS);
  if (parts.length > MAX_CHUNKS) throw new HttpError(413, `El PDF es demasiado largo (máx. ~${(MAX_CHUNKS * CHUNK_CHARS) / 1000}k caracteres de texto)`);
  const out: string[] = [];
  for (const [i, part] of parts.entries()) {
    const header = parts.length > 1 ? `Documento "${name}", parte ${i + 1} de ${parts.length}. Continúa la numeración de secciones de forma natural.\n\n` : `Documento "${name}".\n\n`;
    out.push(await llm(apiKey, model, PDF_TO_MD, header + part, 8000));
  }
  return out.join("\n\n").slice(0, MAX_FILE_MD);
}

const COMPILE = `Eres un editor que prepara el MANUAL DEL AGENTE: el único documento de contexto que leerá un agente IA que responde comentarios en redes sociales en nombre de una marca.
Fusiona en un solo Markdown las instrucciones del dueño, el perfil de la marca y los documentos de conocimiento.
Estructura obligatoria (omite una sección solo si no hay información para ella):
# Manual del agente — <nombre de la marca>
## 1. Identidad y tono
## 2. Reglas de respuesta (instrucciones del dueño, en viñetas imperativas y concretas)
## 3. Información del negocio
## 4. Productos y servicios
## 5. Preguntas frecuentes (formato **P:** / **R:**)
## 6. Políticas (envíos, devoluciones, garantías, pagos…)
## 7. Cuándo derivar a una persona
## 8. Nunca decir / temas prohibidos
Reglas:
- Las instrucciones del dueño PREVALECEN sobre los documentos si se contradicen; anota la contradicción en la sección 2.
- Conserva todos los datos concretos (precios, horarios, condiciones). No inventes nada.
- Elimina duplicados y redacta de forma compacta, escaneable y sin relleno.
- Mantén el idioma de las instrucciones del dueño.
- Longitud máxima aproximada: ${Math.round(MAX_MANUAL * 0.8 / 1000)}k caracteres; si el material es mayor, condensa priorizando lo que sirve para responder clientes.
- Devuelve solo el Markdown.`;

/** Instructions + brand profile + every PDF → one consolidated agent manual. */
export async function compileManual(apiKey: string, model: string, ai: AiSettings, files: KnowledgeFile[]) {
  const b = ai.brand;
  const block = (title: string, v: string) => (v.trim() ? `### ${title}\n${v.trim()}\n` : "");
  const input = [
    "# INSTRUCCIONES DEL DUEÑO",
    ai.instructions.trim() || "(sin instrucciones)",
    "",
    "# PERFIL DE LA MARCA",
    block("Nombre", b.name) + block("Tono", b.tone) + block("Sobre el negocio", b.about) + block("Preguntas frecuentes", b.faq) + block("Nunca decir", b.never) ||
      "(sin perfil)",
    "",
    "# DOCUMENTOS DE CONOCIMIENTO",
    ...(files.length ? files.map((f) => `## Documento: ${f.name}\n\n${f.markdown}`) : ["(sin documentos)"]),
  ].join("\n");
  const manual = await llm(apiKey, model, COMPILE, input, 16000);
  if (!manual) throw new HttpError(502, "La IA no devolvió el manual");
  return manual.slice(0, MAX_MANUAL);
}
