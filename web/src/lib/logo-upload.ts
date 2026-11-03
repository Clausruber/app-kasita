"use client";

import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { storage } from "@/lib/firebase/client";
import { brandingPath } from "@/lib/firebase/paths";

const MAX_SIDE = 1000;
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;

/**
 * Uploads the post logo to Storage as PNG (keeps transparency), at most 1000 px. Unlike the company
 * logo it does not go through Zernio, so it works before the social networks are connected.
 */
export async function uploadPostLogo(ws: string, file: File) {
  if (!file.type.startsWith("image/")) throw new Error("El logo debe ser una imagen");
  if (file.size > MAX_SOURCE_BYTES) throw new Error("El logo pesa más de 5 MB");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
  if (!blob) throw new Error("No se pudo procesar el logo");
  const r = ref(storage, `${brandingPath(ws)}/logo-${crypto.randomUUID()}.png`);
  await uploadBytes(r, blob, { contentType: "image/png", cacheControl: "public,max-age=31536000" });
  return getDownloadURL(r);
}
