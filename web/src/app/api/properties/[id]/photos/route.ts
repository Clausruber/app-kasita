import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { HttpError, withPerm } from "@/lib/auth-guard";
import { adminBucket, adminDb } from "@/lib/firebase/admin";
import { propertyDoc } from "@/lib/firebase/paths";
import { MAX_PHOTOS, thumbPathOf } from "@/lib/property-catalog";
import type { PropertyPhoto } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

// Download URLs come from Firebase Storage.
const STORAGE_HOST = "firebasestorage.googleapis.com";

// The browser uploads straight to Storage (rules limit type and size); these endpoints keep the
// property's photo list in Firestore, which is what the inventory, posts and the AI agent read.

/** Registers an uploaded photo; the path must be inside this property's folder. */
export const POST = withPerm<Ctx>("inventory.edit", async (req, user, { params }) => {
  const { id } = await params;
  const body = (await req.json()) as Partial<PropertyPhoto>;
  const prefix = `${propertyDoc(user.uid, id)}/`;
  if (typeof body.path !== "string" || !body.path.startsWith(prefix) || body.path.includes(".."))
    throw new HttpError(400, "Ruta de foto no válida");
  let url: URL;
  try {
    url = new URL(String(body.url));
  } catch {
    throw new HttpError(400, "URL de foto no válida");
  }
  if (url.host !== STORAGE_HOST || url.protocol !== "https:") throw new HttpError(400, "URL de foto no válida");
  // Optional thumbnail uploaded with it: must be the photo's own "_thumb.jpg" in Storage.
  let thumb: URL | null = null;
  try {
    thumb = body.thumb && body.thumbPath === thumbPathOf(body.path) ? new URL(String(body.thumb)) : null;
  } catch {
    thumb = null;
  }
  if (thumb && (thumb.host !== STORAGE_HOST || thumb.protocol !== "https:")) thumb = null;
  const photo: PropertyPhoto = {
    path: body.path,
    url: url.toString(),
    size: Math.max(0, Number(body.size) || 0),
    ...(Number(body.w) > 0 ? { w: Math.round(Number(body.w)) } : {}),
    ...(Number(body.h) > 0 ? { h: Math.round(Number(body.h)) } : {}),
    ...(thumb ? { thumb: thumb.toString(), thumbPath: body.thumbPath } : {}),
  };
  const ref = adminDb.doc(propertyDoc(user.uid, id));
  const photos = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpError(404, "Inmueble no encontrado");
    const list = (snap.get("photos") ?? []) as PropertyPhoto[];
    if (list.some((p) => p.path === photo.path)) return list;
    if (list.length >= MAX_PHOTOS) throw new HttpError(400, `Máximo ${MAX_PHOTOS} fotos por propiedad`);
    const next = [...list, photo];
    tx.update(ref, { photos: next, updatedAt: FieldValue.serverTimestamp() });
    return next;
  });
  return NextResponse.json({ photos });
});

/** Reorders the photos: `order` is the list of paths, the first one is the cover. */
export const PUT = withPerm<Ctx>("inventory.edit", async (req, user, { params }) => {
  const { id } = await params;
  const { order } = (await req.json()) as { order?: unknown };
  if (!Array.isArray(order)) throw new HttpError(400, "Orden no válido");
  const ref = adminDb.doc(propertyDoc(user.uid, id));
  const photos = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpError(404, "Inmueble no encontrado");
    const list = (snap.get("photos") ?? []) as PropertyPhoto[];
    const byPath = new Map(list.map((p) => [p.path, p]));
    // Photos missing from `order` (uploaded meanwhile in another tab) keep their place at the end.
    const next = [...order.map((p) => byPath.get(String(p))).filter((p): p is PropertyPhoto => !!p), ...list.filter((p) => !order.includes(p.path))];
    tx.update(ref, { photos: next, updatedAt: FieldValue.serverTimestamp() });
    return next;
  });
  return NextResponse.json({ photos });
});

/** Removes one photo from the list and from Storage. */
export const DELETE = withPerm<Ctx>("inventory.edit", async (req, user, { params }) => {
  const { id } = await params;
  const path = new URL(req.url).searchParams.get("path") ?? "";
  if (!path.startsWith(`${propertyDoc(user.uid, id)}/`) || path.includes("..")) throw new HttpError(400, "Ruta de foto no válida");
  const ref = adminDb.doc(propertyDoc(user.uid, id));
  const photos = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpError(404, "Inmueble no encontrado");
    const next = ((snap.get("photos") ?? []) as PropertyPhoto[]).filter((p) => p.path !== path);
    tx.update(ref, { photos: next, updatedAt: FieldValue.serverTimestamp() });
    return next;
  });
  for (const p of [path, thumbPathOf(path)])
    await adminBucket()
      .file(p)
      .delete({ ignoreNotFound: true })
      .catch((e) => console.warn("photo delete", e));
  return NextResponse.json({ photos });
});
