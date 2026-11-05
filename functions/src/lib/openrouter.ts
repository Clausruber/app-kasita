
import { adminDb } from "./firebase/admin";
import { globalAiDoc, userDoc } from "./firebase/paths";
import { decrypt } from "./ai-crypto";
import { HttpError } from "./auth-guard";

export const OPENROUTER_URL = process.env.OPENROUTER_API_URL || "https://openrouter.ai/api/v1";

/** One system + user completion; returns the text without a wrapping Markdown fence. */
export async function llmText(apiKey: string, model: string, system: string, user: string, maxTokens: number, temperature = 0.1) {
  const res = await fetch(`${OPENROUTER_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://kasita-crm.web.app",
      "X-Title": "Social Planner",
    },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
  if (!res.ok) throw new HttpError(502, `OpenRouter: ${body.error?.message ?? res.status}`);
  return (body.choices?.[0]?.message?.content ?? "").replace(/^```(?:markdown|md)?\s*\n|\n```\s*$/g, "").trim();
}

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
  quoteKeywords: string[]; // comment words that ask for a quote by private reply
  quoteKeywordsOnly: boolean; // true: send quotes only when one of them appears
  hasKey: boolean;
  keyHint: string | null;
};

// Keep in sync with functions/src/agent.ts DEFAULT_QUOTE_KEYWORDS.
export const DEFAULT_QUOTE_KEYWORDS = ["cotiza"];

export const DEFAULT_AI: AiSettings = {
  mode: "off",
  textModel: null,
  instructions: "",
  brand: { name: "", tone: "", about: "", faq: "", never: "" },
  quoteKeywords: DEFAULT_QUOTE_KEYWORDS,
  quoteKeywordsOnly: false,
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
    quoteKeywords: Array.isArray(ai.quoteKeywords) ? ai.quoteKeywords : DEFAULT_QUOTE_KEYWORDS,
    quoteKeywordsOnly: ai.quoteKeywordsOnly === true,
    ...global,
  };
}
