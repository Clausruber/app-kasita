import "server-only";

import { randomUUID } from "crypto";
import sharp from "sharp";
import { adminBucket } from "@/lib/firebase/admin";
import { THUMB_QUALITY, THUMB_SIDE, thumbPathOf } from "@/lib/property-catalog";
import type { PropertyPhoto } from "@/lib/types";

/** A small JPEG for lists and pickers (the full photo stays for posts, quotes and the PDF). */
export function renderThumb(photo: Buffer) {
  return sharp(photo)
    .rotate()
    .resize({ width: THUMB_SIDE, height: THUMB_SIDE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: Math.round(THUMB_QUALITY * 100) })
    .toBuffer();
}

/** Saves the thumbnail next to the photo (same folder, `_thumb.jpg`) with its own download token. */
export async function saveThumb(path: string, data: Buffer): Promise<Pick<PropertyPhoto, "thumb" | "thumbPath">> {
  const bucket = adminBucket();
  const thumbPath = thumbPathOf(path);
  const token = randomUUID();
  await bucket.file(thumbPath).save(data, {
    contentType: "image/jpeg",
    resumable: false,
    metadata: { cacheControl: "public,max-age=31536000", metadata: { firebaseStorageDownloadTokens: token } },
  });
  return { thumbPath, thumb: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(thumbPath)}?alt=media&token=${token}` };
}

/** Downloads a stored photo and creates its thumbnail. */
export async function thumbForStoredPhoto(path: string) {
  const [data] = await adminBucket().file(path).download();
  return saveThumb(path, await renderThumb(data));
}
