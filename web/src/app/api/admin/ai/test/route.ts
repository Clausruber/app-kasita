import { NextResponse } from "next/server";
import { HttpError, withSuperAdmin } from "@/lib/auth-guard";
import { OPENROUTER_URL, getGlobalOpenRouterKey } from "@/lib/openrouter";

// Checks the global OpenRouter key against GET /key (no tokens spent).
export const POST = withSuperAdmin(async () => {
  const key = await getGlobalOpenRouterKey();
  if (!key) throw new HttpError(400, "No hay ninguna API key de OpenRouter guardada");

  const res = await fetch(`${OPENROUTER_URL}/key`, { headers: { Authorization: `Bearer ${key}` }, cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as {
    data?: { label?: string; usage?: number; limit_remaining?: number | null };
    error?: { message?: string };
  };
  if (!res.ok) throw new HttpError(400, body.error?.message || "OpenRouter rechazó la key");
  return NextResponse.json({
    ok: true,
    label: body.data?.label ?? null,
    usage: body.data?.usage ?? null,
    remaining: body.data?.limit_remaining ?? null,
  });
});
