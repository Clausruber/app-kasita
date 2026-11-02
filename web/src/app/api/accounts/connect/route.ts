import { NextResponse } from "next/server";
import { HttpError, withPerm } from "@/lib/auth-guard";
import { getProfileForUser, zernio } from "@/lib/zernio";
import { PLATFORMS } from "@/lib/platforms";

// Returns the Zernio OAuth URL to connect a new social account.
export const POST = withPerm("settings.redes", async (req, user) => {
  const { platform } = (await req.json()) as { platform?: string };
  if (!platform || !PLATFORMS.some((p) => p.id === platform)) throw new HttpError(400, "Plataforma no válida");

  const profileId = await getProfileForUser(user.uid, user.email);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  const { authUrl } = await zernio<{ authUrl: string }>(user.uid, `/connect/${platform}`, {
    query: { profileId, redirect_url: `${appUrl}/callback` },
  });
  return NextResponse.json({ authUrl });
});
