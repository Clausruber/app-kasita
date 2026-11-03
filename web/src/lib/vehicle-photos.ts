"use client";

import { getDownloadURL, ref, uploadBytesResumable } from "firebase/storage";
import { storage } from "@/lib/firebase/client";
import { vehicleDoc } from "@/lib/firebase/paths";
import type { VehiclePhoto } from "@/lib/types";

export const MAX_SOURCE_BYTES = 15 * 1024 * 1024; // before compression (phone photos)
const MAX_SIDE = 1920;
const QUALITY = 0.82;

/** Resizes to at most 1920 px and re-encodes as JPEG (what every social network and ML accept). */
async function compress(file: File): Promise<{ blob: Blob; w: number; h: number }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", QUALITY));
  if (!blob) throw new Error(`No se pudo procesar ${file.name}`);
  return { blob, w, h };
}

/** Uploads one photo to `{vehicleDoc}/{uuid}.jpg` and returns the data to register it on the vehicle. */
export async function uploadVehiclePhoto(ws: string, vehicleId: string, file: File, onProgress: (pct: number) => void): Promise<VehiclePhoto> {
  if (!file.type.startsWith("image/")) throw new Error(`${file.name} no es una imagen`);
  if (file.size > MAX_SOURCE_BYTES) throw new Error(`${file.name} pesa más de 15 MB`);
  const { blob, w, h } = await compress(file);
  const path = `${vehicleDoc(ws, vehicleId)}/${crypto.randomUUID()}.jpg`;
  const task = uploadBytesResumable(ref(storage, path), blob, { contentType: "image/jpeg", cacheControl: "public,max-age=31536000" });
  await new Promise<void>((resolve, reject) =>
    task.on("state_changed", (s) => onProgress(Math.round((s.bytesTransferred / s.totalBytes) * 100)), reject, () => resolve()),
  );
  return { path, url: await getDownloadURL(task.snapshot.ref), w, h, size: blob.size };
}
