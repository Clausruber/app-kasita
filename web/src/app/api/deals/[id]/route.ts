import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { HttpError, withPerm } from "@/lib/auth-guard";
import { adminDb } from "@/lib/firebase/admin";
import { dealDoc } from "@/lib/firebase/paths";
import { assertDealAccess, parseDealInput, toDealRow } from "@/lib/deals-server";

type Ctx = { params: Promise<{ id: string }> };

async function load(uid: string, id: string) {
  const ref = adminDb.doc(dealDoc(uid, id));
  const snap = await ref.get();
  if (!snap.exists) throw new HttpError(404, "Oportunidad no encontrada");
  return { ref, data: snap.data()! };
}

// Stage, salesperson, linked client/vehicle, value and notes. Apartado/vendido go through their own endpoints.
export const PATCH = withPerm<Ctx>("deals.edit", async (req, user, { params }) => {
  const { id } = await params;
  const { ref, data } = await load(user.uid, id);
  assertDealAccess(user, data);
  const update = await parseDealInput(user.uid, user, await req.json(), data);
  await ref.update({ ...update, updatedAt: FieldValue.serverTimestamp() });
  return NextResponse.json({ deal: toDealRow(id, (await ref.get()).data()!) });
});

export const DELETE = withPerm<Ctx>("deals.edit", async (_req, user, { params }) => {
  const { id } = await params;
  const { ref, data } = await load(user.uid, id);
  assertDealAccess(user, data);
  if (data.stage === "apartado" || data.stage === "vendido") throw new HttpError(409, "No se puede borrar una oportunidad apartada o vendida");
  await ref.delete();
  return NextResponse.json({ ok: true });
});
