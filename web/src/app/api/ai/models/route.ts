import { NextResponse } from "next/server";
import { withUser } from "@/lib/auth-guard";
import { OPENROUTER_URL } from "@/lib/openrouter";

type OrModel = {
  id: string;
  name: string;
  context_length?: number;
  architecture?: { output_modalities?: string[] };
  pricing?: { prompt?: string; completion?: string };
};

// OpenAI text models available on OpenRouter (public list, cached for an hour).
export const GET = withUser(async () => {
  const res = await fetch(`${OPENROUTER_URL}/models`, { next: { revalidate: 3600 } });
  if (!res.ok) return NextResponse.json({ error: "No se pudo leer la lista de modelos" }, { status: 502 });
  const { data } = (await res.json()) as { data: OrModel[] };

  const perMillion = (v?: string) => (v ? Math.round(Number(v) * 1e6 * 100) / 100 : null);
  const models = data
    .filter(
      (m) =>
        m.id.startsWith("openai/") &&
        !m.id.endsWith(":batch") &&
        (m.architecture?.output_modalities ?? ["text"]).join() === "text",
    )
    .map((m) => ({
      id: m.id,
      name: m.name,
      context: m.context_length ?? null,
      prompt: perMillion(m.pricing?.prompt),
      completion: perMillion(m.pricing?.completion),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({ models });
});
