import { NextResponse } from "next/server";
import { HttpError, withPerm } from "@/lib/auth-guard";
import { adminDb } from "@/lib/firebase/admin";
import { userDoc } from "@/lib/firebase/paths";

const DEFAULT_HOURS = 4;

// Hours a DM can wait without an answer before the scheduler creates a follow-up (functions/src/followups.ts).
export const GET = withPerm("settings.agente", async (_req, user) => {
  const hours = Number((await adminDb.doc(userDoc(user.uid)).get()).get("followUp.staleHours")) || DEFAULT_HOURS;
  return NextResponse.json({ staleHours: hours });
});

export const PUT = withPerm("settings.agente", async (req, user) => {
  const { staleHours } = (await req.json()) as { staleHours?: unknown };
  const hours = Number(staleHours);
  if (!Number.isFinite(hours) || hours < 1 || hours > 72) throw new HttpError(400, "Indica entre 1 y 72 horas");
  await adminDb.doc(userDoc(user.uid)).set({ followUp: { staleHours: Math.round(hours) } }, { merge: true });
  return NextResponse.json({ staleHours: Math.round(hours) });
});
