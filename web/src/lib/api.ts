"use client";

import { auth } from "@/lib/firebase/client";

/** Calls our Next.js API with the user's Firebase ID token. */
export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch(path, {
    method: init.method ?? "GET",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Error ${res.status}`);
  return data as T;
}

/** Sends a multipart form (file uploads) to our API with the user's ID token. */
export async function apiForm<T = unknown>(path: string, form: FormData): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch(path, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Error ${res.status}`);
  return data as T;
}

/** Uploads a file to Zernio via a presigned URL and returns the media item for a post. */
export async function uploadMedia(file: File) {
  const { uploadUrl, publicUrl } = await api<{ uploadUrl: string; publicUrl: string }>("/api/media/presign", {
    method: "POST",
    body: { filename: file.name, contentType: file.type, size: file.size },
  });
  const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
  if (!put.ok) throw new Error(`No se pudo subir ${file.name}`);
  const type = file.type.startsWith("video/") ? "video" : file.type === "image/gif" ? "gif" : "image";
  return { url: publicUrl, type };
}

/** Downloads a file from our API (with the ID token) and saves it with `fileName`. */
export async function apiDownload(path: string, fileName: string) {
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || `Error ${res.status}`);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: fileName });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
