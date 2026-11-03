import { NextResponse } from "next/server";
import { HttpError, withPerm, withUser } from "@/lib/auth-guard";
import { adminDb } from "@/lib/firebase/admin";
import { userDoc } from "@/lib/firebase/paths";
import { normaliseImageSettings } from "@/lib/watermark";
import { readPostImages, isAllowedMediaUrl } from "@/lib/watermark-server";

// Logo on post photos (Ajustes → Imágenes). Anyone in the workspace reads it (the composer needs it);
// only settings.imagenes changes it.
export const GET = withUser(async (_req, user) => NextResponse.json(await readPostImages(user.uid)));

export const PUT = withPerm("settings.imagenes", async (req, user) => {
  const body = (await req.json()) as Record<string, unknown>;
  const s = normaliseImageSettings(body);
  if (s.logoUrl && !isAllowedMediaUrl(s.logoUrl)) throw new HttpError(400, "Logo no válido: súbelo desde esta pantalla");
  // `logoUrl: ""` means "use the company logo" (kept as fallback, not copied).
  await adminDb.doc(userDoc(user.uid)).set({ postImages: { ...s, logoUrl: typeof body.logoUrl === "string" ? s.logoUrl : "" } }, { merge: true });
  return NextResponse.json(await readPostImages(user.uid));
});
