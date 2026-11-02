import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { HttpError, withPerm } from "@/lib/auth-guard";
import { adminDb } from "@/lib/firebase/admin";
import { aiKnowledgeDoc } from "@/lib/firebase/paths";
import { MAX_MANUAL } from "@/lib/knowledge";
import { knowledgeState, recompile } from "@/lib/knowledge-store";

export const maxDuration = 300;

// Regenerate the manual from instructions + brand profile + documents.
export const POST = withPerm("settings.agente", async (_req, user) => {
  await recompile(user.uid);
  return NextResponse.json(await knowledgeState(user.uid));
});

// Save a manual edited by hand. It stays as written until the next regeneration.
export const PUT = withPerm("settings.agente", async (req, user) => {
  const { manual } = (await req.json()) as { manual?: string };
  if (typeof manual !== "string") throw new HttpError(400, "Falta manual");
  if (manual.length > MAX_MANUAL) throw new HttpError(400, `El manual supera ${MAX_MANUAL / 1000}k caracteres`);
  await adminDb.doc(aiKnowledgeDoc(user.uid)).set(
    { manual: manual.trim(), manualSource: "edited", manualUpdatedAt: FieldValue.serverTimestamp(), stale: false },
    { merge: true },
  );
  return NextResponse.json(await knowledgeState(user.uid));
});
