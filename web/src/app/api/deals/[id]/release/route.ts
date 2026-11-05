import { NextResponse } from "next/server";
import { withPerm } from "@/lib/auth-guard";
import { adminDb } from "@/lib/firebase/admin";
import { dealDoc } from "@/lib/firebase/paths";
import { releaseDeal, toDealRow } from "@/lib/deals-server";

type Ctx = { params: Promise<{ id: string }> };

// Cancels an apartado: the property is available again and the deal goes back to negotiation.
export const POST = withPerm<Ctx>("deals.void", async (_req, user, { params }) => {
  const { id } = await params;
  await releaseDeal(user.uid, user, id);
  return NextResponse.json({ deal: toDealRow(id, (await adminDb.doc(dealDoc(user.uid, id)).get()).data()!) });
});
