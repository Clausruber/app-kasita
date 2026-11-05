
import { FieldValue, type Timestamp } from "firebase-admin/firestore";
import { HttpError } from "./auth-guard";
import { adminDb } from "./firebase/admin";
import { aiKnowledgeDoc, aiKnowledgeFilesCol } from "./firebase/paths";
import { compileManual, type KnowledgeFile } from "./knowledge";
import { getGlobalOpenRouterKey, readAiSettings } from "./openrouter";

export type KnowledgeState = {
  files: { id: string; name: string; pages: number; chars: number; source: "pdf" | "company"; createdAt: string | null }[];
  manual: string;
  manualSource: "generated" | "edited" | null;
  manualUpdatedAt: string | null;
  stale: boolean;
};

const iso = (t?: Timestamp | null) => (t ? t.toDate().toISOString() : null);

export async function loadFiles(uid: string): Promise<(KnowledgeFile & { source: "pdf" | "company"; createdAt: Timestamp | null })[]> {
  const snap = await adminDb.collection(aiKnowledgeFilesCol(uid)).orderBy("createdAt", "asc").get();
  return snap.docs.map((d) => ({
    id: d.id,
    name: d.get("name"),
    pages: d.get("pages") ?? 0,
    chars: d.get("chars") ?? 0,
    markdown: d.get("markdown") ?? "",
    source: d.get("source") === "company" ? ("company" as const) : ("pdf" as const),
    createdAt: d.get("createdAt") ?? null,
  }));
}

export async function knowledgeState(uid: string): Promise<KnowledgeState> {
  const [doc, files] = await Promise.all([adminDb.doc(aiKnowledgeDoc(uid)).get(), loadFiles(uid)]);
  return {
    files: files.map(({ id, name, pages, chars, source, createdAt }) => ({ id, name, pages, chars, source, createdAt: iso(createdAt) })),
    manual: doc.get("manual") ?? "",
    manualSource: doc.get("manualSource") ?? null,
    manualUpdatedAt: iso(doc.get("manualUpdatedAt")),
    stale: Boolean(doc.get("stale")),
  };
}

/** The key and model the user configured; knowledge processing uses the same text model as the agent. */
export async function requireAi(uid: string) {
  const [ai, apiKey] = await Promise.all([readAiSettings(uid), getGlobalOpenRouterKey()]);
  if (!apiKey || !ai.textModel) throw new HttpError(400, "El administrador aún no ha configurado la IA (API key de OpenRouter y modelo)");
  return { ai, apiKey, model: ai.textModel };
}

/** Rebuilds the agent manual from instructions + brand profile + every uploaded document. */
export async function recompile(uid: string) {
  const { ai, apiKey, model } = await requireAi(uid);
  const files = await loadFiles(uid);
  const manual = await compileManual(apiKey, model, ai, files);
  await adminDb.doc(aiKnowledgeDoc(uid)).set(
    { manual, manualSource: "generated", manualModel: model, manualUpdatedAt: FieldValue.serverTimestamp(), stale: false },
    { merge: true },
  );
}
