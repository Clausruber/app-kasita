import { NextResponse } from "next/server";
import { HttpError, withUser } from "@/lib/auth-guard";
import { zernio } from "@/lib/zernio";

const MAX_SIZE = 5 * 1024 ** 3; // 5 GB, Zernio's limit

// Returns a presigned URL; the browser PUTs the file there directly.
export const POST = withUser(async (req, user) => {
  const { filename, contentType, size } = (await req.json()) as {
    filename?: string;
    contentType?: string;
    size?: number;
  };
  if (!filename || !contentType) throw new HttpError(400, "Faltan filename o contentType");
  if (size && size > MAX_SIZE) throw new HttpError(400, "El archivo supera 5 GB");

  const data = await zernio<{ uploadUrl: string; publicUrl: string }>(user.uid, "/media/presign", {
    method: "POST",
    body: { filename, contentType, size },
  });
  return NextResponse.json({ uploadUrl: data.uploadUrl, publicUrl: data.publicUrl });
});
