import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { HttpError, withPerm } from "@/lib/auth-guard";
import { actorCan } from "@/lib/actor";
import { adminBucket, adminDb } from "@/lib/firebase/admin";
import { propertyDoc } from "@/lib/firebase/paths";
import { parsePropertyInput, toPropertyRow } from "@/lib/properties";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPerm<Ctx>("inventory", async (_req, user, { params }) => {
  const { id } = await params;
  const snap = await adminDb.doc(propertyDoc(user.uid, id)).get();
  if (!snap.exists) throw new HttpError(404, "Inmueble no encontrado");
  return NextResponse.json({ property: toPropertyRow(id, snap.data()!, actorCan(user.actor, "inventory.private")) });
});

// Full edit of the property data. A reserved, sold or rented unit keeps its status (the deal endpoints own it).
export const PUT = withPerm<Ctx>("inventory.edit", async (req, user, { params }) => {
  const { id } = await params;
  const canPrivate = actorCan(user.actor, "inventory.private");
  const ref = adminDb.doc(propertyDoc(user.uid, id));
  const snap = await ref.get();
  if (!snap.exists) throw new HttpError(404, "Inmueble no encontrado");
  const { status, ...data } = parsePropertyInput(await req.json(), canPrivate);
  const locked = ["apartado", "vendido", "rentado"].includes(snap.get("status"));
  await ref.update({ ...data, ...(locked ? {} : { status }), updatedAt: FieldValue.serverTimestamp() });
  return NextResponse.json({ property: toPropertyRow(id, (await ref.get()).data()!, canPrivate) });
});

// Removes the property and its photos (only this property's Storage prefix).
export const DELETE = withPerm<Ctx>("inventory.delete", async (_req, user, { params }) => {
  const { id } = await params;
  const ref = adminDb.doc(propertyDoc(user.uid, id));
  const snap = await ref.get();
  if (!snap.exists) throw new HttpError(404, "Inmueble no encontrado");
  if (["vendido", "rentado"].includes(snap.get("status")))
    throw new HttpError(409, "Un inmueble vendido o rentado no se puede borrar: queda en el historial de operaciones");
  if (snap.get("status") === "apartado") throw new HttpError(409, "Libera el apartado antes de borrar el inmueble");
  await adminBucket().deleteFiles({ prefix: `${propertyDoc(user.uid, id)}/` }).catch((e) => console.warn("photos cleanup", e));
  await ref.delete();
  return NextResponse.json({ ok: true });
});
