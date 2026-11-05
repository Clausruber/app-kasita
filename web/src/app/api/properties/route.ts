import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { withPerm } from "@/lib/auth-guard";
import { actorCan } from "@/lib/actor";
import { adminDb } from "@/lib/firebase/admin";
import { propertiesCol } from "@/lib/firebase/paths";
import { parsePropertyInput, toPropertyRow } from "@/lib/properties";

// The whole inventory, most recently changed first (filters are applied in the browser).
export const GET = withPerm("inventory", async (_req, user) => {
  const showPrivate = actorCan(user.actor, "inventory.private");
  const snap = await adminDb.collection(propertiesCol(user.uid)).orderBy("updatedAt", "desc").limit(1000).get();
  return NextResponse.json({ properties: snap.docs.map((d) => toPropertyRow(d.id, d.data(), showPrivate)) });
});

export const POST = withPerm("inventory.edit", async (req, user) => {
  const canPrivate = actorCan(user.actor, "inventory.private");
  const data = parsePropertyInput(await req.json(), canPrivate);
  const ref = adminDb.collection(propertiesCol(user.uid)).doc();
  await ref.set({
    ...data,
    photos: [],
    reservation: null,
    lease: null,
    closedAt: null,
    createdBy: user.actor.authUid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return NextResponse.json({ property: toPropertyRow(ref.id, (await ref.get()).data()!, canPrivate) });
});
