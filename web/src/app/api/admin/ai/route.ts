import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { HttpError, withSuperAdmin } from "@/lib/auth-guard";
import { adminDb } from "@/lib/firebase/admin";
import { globalAiDoc } from "@/lib/firebase/paths";
import { encrypt } from "@/lib/ai-crypto";
import { readGlobalAi } from "@/lib/openrouter";

// Global AI provider settings shared by every account: OpenRouter key (encrypted) + text model.
export const GET = withSuperAdmin(async () => NextResponse.json(await readGlobalAi()));

export const PUT = withSuperAdmin(async (req, user) => {
  const body = (await req.json()) as { openrouterKey?: string; clearKey?: boolean; textModel?: string | null };
  const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp(), updatedBy: user.email ?? user.uid };

  const key = body.openrouterKey?.trim();
  if (key) {
    if (!/^sk-or-[\w-]{10,}$/.test(key)) throw new HttpError(400, "La key de OpenRouter debe empezar por sk-or-");
    update.openrouterKey = encrypt(key);
    update.keyHint = `…${key.slice(-4)}`;
  } else if (body.clearKey) {
    update.openrouterKey = FieldValue.delete();
    update.keyHint = FieldValue.delete();
  }
  if (body.textModel !== undefined) {
    if (body.textModel !== null && !/^openai\/[\w.\-:]+$/.test(body.textModel)) throw new HttpError(400, "Modelo no válido");
    update.textModel = body.textModel;
  }

  await adminDb.doc(globalAiDoc()).set(update, { merge: true });
  return NextResponse.json(await readGlobalAi());
});
