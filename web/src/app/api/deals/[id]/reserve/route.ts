import { NextResponse } from "next/server";
import { withPerm } from "@/lib/auth-guard";
import { adminDb } from "@/lib/firebase/admin";
import { dealDoc } from "@/lib/firebase/paths";
import { reserveDeal, toDealRow } from "@/lib/deals-server";

type Ctx = { params: Promise<{ id: string }> };

// Apartado: the property leaves the available stock until it is sold or released.
export const POST = withPerm<Ctx>("deals.reserve", async (req, user, { params }) => {
  const { id } = await params;
  await reserveDeal(user.uid, user, id, await req.json());
  return NextResponse.json({ deal: toDealRow(id, (await adminDb.doc(dealDoc(user.uid, id)).get()).data()!) });
});
