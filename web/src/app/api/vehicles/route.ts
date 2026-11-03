import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { withPerm } from "@/lib/auth-guard";
import { actorCan } from "@/lib/actor";
import { adminDb } from "@/lib/firebase/admin";
import { vehiclesCol } from "@/lib/firebase/paths";
import { parseVehicleInput, toVehicleRow } from "@/lib/vehicles";

// The whole inventory, most recently changed first (filters are applied in the browser).
export const GET = withPerm("inventory", async (_req, user) => {
  const showPrivate = actorCan(user.actor, "inventory.private");
  const snap = await adminDb.collection(vehiclesCol(user.uid)).orderBy("updatedAt", "desc").limit(1000).get();
  return NextResponse.json({ vehicles: snap.docs.map((d) => toVehicleRow(d.id, d.data(), showPrivate)) });
});

export const POST = withPerm("inventory.edit", async (req, user) => {
  const canPrivate = actorCan(user.actor, "inventory.private");
  const data = parseVehicleInput(await req.json(), canPrivate);
  const ref = adminDb.collection(vehiclesCol(user.uid)).doc();
  await ref.set({
    ...data,
    photos: [],
    reservation: null,
    soldAt: null,
    mlPermalink: null,
    createdBy: user.actor.authUid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return NextResponse.json({ vehicle: toVehicleRow(ref.id, (await ref.get()).data()!, canPrivate) });
});
