import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { globalAiDoc, userDoc } from "@/lib/firebase/paths";
import { decrypt } from "@/lib/ai-crypto";

export const OPENROUTER_URL = process.env.OPENROUTER_API_URL || "https://openrouter.ai/api/v1";

export const AI_MODES = ["off", "manual", "auto"] as const;
export type AiMode = (typeof AI_MODES)[number];

/**
 * What an account sees of the agent. mode/instructions/brand are per account; the OpenRouter key
 * and the text model are global (SuperAdmin), exposed here read-only as textModel/hasKey/keyHint.
 */
export type AiSettings = {
  mode: AiMode;
  textModel: string | null;
  instructions: string;
  brand: { name: string; tone: string; about: string; faq: string; never: string };
  hasKey: boolean;
  keyHint: string | null;
};

export const DEFAULT_AI: AiSettings = {
  mode: "off",
  textModel: null,
  instructions: "",
  brand: { name: "", tone: "", about: "", faq: "", never: "" },
  hasKey: false,
  keyHint: null,
};

export type GlobalAi = { textModel: string | null; hasKey: boolean; keyHint: string | null };

export async function readGlobalAi(): Promise<GlobalAi> {
  const snap = await adminDb.doc(globalAiDoc()).get();
  return {
    textModel: (snap.get("textModel") as string | undefined) ?? null,
    hasKey: Boolean(snap.get("openrouterKey")),
    keyHint: (snap.get("keyHint") as string | undefined) ?? null,
  };
}

/** The global OpenRouter key (decrypted), or null. Server-only. */
export async function getGlobalOpenRouterKey(): Promise<string | null> {
  const snap = await adminDb.doc(globalAiDoc()).get();
  const enc = snap.get("openrouterKey") as string | undefined;
  return enc ? decrypt(enc) : null;
}

export async function readAiSettings(uid: string): Promise<AiSettings> {
  const [snap, global] = await Promise.all([adminDb.doc(userDoc(uid)).get(), readGlobalAi()]);
  const ai = (snap.get("ai") ?? {}) as Partial<AiSettings>;
  return {
    mode: ai.mode ?? DEFAULT_AI.mode,
    instructions: ai.instructions ?? "",
    brand: { ...DEFAULT_AI.brand, ...(ai.brand ?? {}) },
    ...global,
  };
}
