import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { HttpError, withPerm } from "@/lib/auth-guard";
import { adminDb } from "@/lib/firebase/admin";
import { aiKnowledgeFilesCol } from "@/lib/firebase/paths";
import { MAX_PDF_BYTES, extractPdfText, pdfToMarkdown } from "@/lib/knowledge";
import { knowledgeState, recompile, requireAi } from "@/lib/knowledge-store";

// PDF → Markdown and manual compilation call the LLM several times.
export const maxDuration = 300;

const MAX_FILES = 10;

export const GET = withPerm("settings.agente", async (_req, user) => NextResponse.json(await knowledgeState(user.uid)));

// Upload a PDF: extract its text, turn it into structured Markdown, store it and rebuild the manual.
export const POST = withPerm("settings.agente", async (req, user) => {
  const { apiKey, model } = await requireAi(user.uid);
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Adjunta un PDF");
  if (file.size > MAX_PDF_BYTES) throw new HttpError(413, "El PDF supera 15 MB");
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") throw new HttpError(400, "Solo se aceptan archivos PDF");

  const col = adminDb.collection(aiKnowledgeFilesCol(user.uid));
  // The Empresa document does not count towards the PDF limit.
  if ((await col.get()).docs.filter((d) => d.get("source") !== "company").length >= MAX_FILES) throw new HttpError(400, `Máximo ${MAX_FILES} documentos`);

  const { pages, text } = await extractPdfText(new Uint8Array(await file.arrayBuffer()));
  if (text.length < 20)
    throw new HttpError(422, "El PDF no tiene texto seleccionable (parece escaneado). Exporta una versión con texto.");

  const markdown = await pdfToMarkdown(apiKey, model, file.name, text);
  await col.add({
    name: file.name.slice(0, 200),
    pages,
    size: file.size,
    chars: markdown.length,
    markdown,
    model,
    createdAt: FieldValue.serverTimestamp(),
  });
  await recompile(user.uid);
  return NextResponse.json(await knowledgeState(user.uid), { status: 201 });
});

// Remove a document and rebuild the manual without it.
export const DELETE = withPerm("settings.agente", async (req, user) => {
  const id = new URL(req.url).searchParams.get("fileId");
  if (!id) throw new HttpError(400, "Falta fileId");
  const ref = adminDb.collection(aiKnowledgeFilesCol(user.uid)).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpError(404, "Documento no encontrado");
  if (snap.get("source") === "company") throw new HttpError(400, "Este documento se genera desde Ajustes → Empresa: edita allí los datos");
  await ref.delete();
  await recompile(user.uid);
  return NextResponse.json(await knowledgeState(user.uid));
});
