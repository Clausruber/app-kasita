import { NextResponse } from "next/server";
import { withPerm } from "@/lib/auth-guard";
import { adminDb } from "@/lib/firebase/admin";
import { dealDoc } from "@/lib/firebase/paths";
import { closeDeal, toDealRow } from "@/lib/deals-server";

type Ctx = { params: Promise<{ id: string }> };

// Closes the deal as a sale or a rental: records the operation, marks the property vendido/rentado and closes competing deals.
export const POST = withPerm<Ctx>("deals.sell", async (req, user, { params }) => {
  const { id } = await params;
  const saleId = await closeDeal(user.uid, user, id, await req.json());
  return NextResponse.json({ saleId, deal: toDealRow(id, (await adminDb.doc(dealDoc(user.uid, id)).get()).data()!) });
});
