import { NextResponse } from "next/server";
import { HttpError, withUser } from "@/lib/auth-guard";
import { actorCan } from "@/lib/actor";
import { adminDb } from "@/lib/firebase/admin";
import { aiKnowledgeDoc, userDoc } from "@/lib/firebase/paths";
import { AI_MODES, readAiSettings, type AiMode, type AiSettings } from "@/lib/openrouter";

const MAX = { instructions: 4000, field: 2000 };
const clip = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

export const GET = withUser(async (_req, user) => NextResponse.json(await readAiSettings(user.uid)));

// Saves the account's agent settings (mode, instructions, brand). The OpenRouter key and the
// text model are global and only the SuperAdmin changes them (/api/admin/ai).
export const PUT = withUser(async (req, user) => {
  const body = (await req.json()) as Partial<AiSettings>;
  // The inbox mode toggle may be granted on its own; anything else is the Agente IA tab.
  const onlyMode = Object.keys(body).every((k) => k === "mode");
  if (!actorCan(user.actor, "settings.agente") && !(onlyMode && actorCan(user.actor, "inbox.agentMode")))
    throw new HttpError(403, "No tienes acceso a esta sección");
  if (body.mode && !AI_MODES.includes(body.mode as AiMode)) throw new HttpError(400, "Modo no válido");

  const current = await readAiSettings(user.uid);
  const next: AiSettings = {
    ...current,
    mode: (body.mode as AiMode) ?? current.mode,
    instructions: body.instructions !== undefined ? clip(body.instructions, MAX.instructions) : current.instructions,
    brand: body.brand
      ? {
          name: clip(body.brand.name, 200),
          tone: clip(body.brand.tone, MAX.field),
          about: clip(body.brand.about, MAX.field),
          faq: clip(body.brand.faq, MAX.field),
          never: clip(body.brand.never, MAX.field),
        }
      : current.brand,
  };

  if (next.mode !== "off" && (!next.hasKey || !next.textModel))
    throw new HttpError(400, "El administrador aún no ha configurado la IA (API key de OpenRouter y modelo)");

  const { mode, instructions, brand } = next;
  await adminDb.doc(userDoc(user.uid)).set({ ai: { mode, instructions, brand } }, { merge: true });
  // The compiled manual embeds instructions and brand profile: flag it for regeneration when they change.
  if (JSON.stringify([current.instructions, current.brand]) !== JSON.stringify([next.instructions, next.brand])) {
    const k = adminDb.doc(aiKnowledgeDoc(user.uid));
    if ((await k.get()).get("manual")) await k.update({ stale: true });
  }
  return NextResponse.json(next);
});
