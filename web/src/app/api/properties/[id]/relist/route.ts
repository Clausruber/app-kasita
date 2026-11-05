import { NextResponse } from "next/server";
import { withPerm } from "@/lib/auth-guard";
import { actorCan } from "@/lib/actor";
import { relistProperty } from "@/lib/deals-server";
import { adminDb } from "@/lib/firebase/admin";
import { propertyDoc } from "@/lib/firebase/paths";
import { toPropertyRow } from "@/lib/properties";

type Ctx = { params: Promise<{ id: string }> };

// "Volver a disponible": the lease of a rented property ended and it goes back on the market.
export const POST = withPerm<Ctx>("inventory.edit", async (_req, user, { params }) => {
  const { id } = await params;
  await relistProperty(user.uid, id);
  const snap = await adminDb.doc(propertyDoc(user.uid, id)).get();
  return NextResponse.json({ property: toPropertyRow(id, snap.data()!, actorCan(user.actor, "inventory.private")) });
});
