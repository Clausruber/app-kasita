import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { HttpError, withPerm } from "@/lib/auth-guard";
import { actorCan } from "@/lib/actor";
import { adminBucket, adminDb } from "@/lib/firebase/admin";
import { vehicleDoc } from "@/lib/firebase/paths";
import { parseVehicleInput, toVehicleRow } from "@/lib/vehicles";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPerm<Ctx>("inventory", async (_req, user, { params }) => {
  const { id } = await params;
  const snap = await adminDb.doc(vehicleDoc(user.uid, id)).get();
  if (!snap.exists) throw new HttpError(404, "Auto no encontrado");
  return NextResponse.json({ vehicle: toVehicleRow(id, snap.data()!, actorCan(user.actor, "inventory.private")) });
});

// Full edit of the vehicle data. A reserved or sold unit keeps its status (the deal endpoints own it).
export const PUT = withPerm<Ctx>("inventory.edit", async (req, user, { params }) => {
  const { id } = await params;
  const canPrivate = actorCan(user.actor, "inventory.private");
  const ref = adminDb.doc(vehicleDoc(user.uid, id));
  const snap = await ref.get();
  if (!snap.exists) throw new HttpError(404, "Auto no encontrado");
  const { status, ...data } = parseVehicleInput(await req.json(), canPrivate);
  const locked = snap.get("status") === "apartado" || snap.get("status") === "vendido";
  await ref.update({ ...data, ...(locked ? {} : { status }), updatedAt: FieldValue.serverTimestamp() });
  return NextResponse.json({ vehicle: toVehicleRow(id, (await ref.get()).data()!, canPrivate) });
});

// Removes the vehicle and its photos (only this vehicle's Storage prefix).
export const DELETE = withPerm<Ctx>("inventory.delete", async (_req, user, { params }) => {
  const { id } = await params;
  const ref = adminDb.doc(vehicleDoc(user.uid, id));
  const snap = await ref.get();
  if (!snap.exists) throw new HttpError(404, "Auto no encontrado");
  if (snap.get("status") === "vendido") throw new HttpError(409, "Un auto vendido no se puede borrar: queda en el historial de ventas");
  if (snap.get("status") === "apartado") throw new HttpError(409, "Libera el apartado antes de borrar el auto");
  await adminBucket().deleteFiles({ prefix: `${vehicleDoc(user.uid, id)}/` }).catch((e) => console.warn("photos cleanup", e));
  await ref.delete();
  return NextResponse.json({ ok: true });
});
