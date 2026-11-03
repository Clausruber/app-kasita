import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { withPerm } from "@/lib/auth-guard";
import { actorCan } from "@/lib/actor";
import { adminDb } from "@/lib/firebase/admin";
import { dealsCol } from "@/lib/firebase/paths";
import { createDealFor, listSellers, sellerIdOf, toDealRow } from "@/lib/deals-server";

// Closed deals (sold / lost) stay on the board this long.
const CLOSED_DAYS = 30;

// Pipeline: open deals plus recently closed ones, and the salespeople to assign them to.
export const GET = withPerm("deals", async (_req, user) => {
  const all = actorCan(user.actor, "deals.assignAll");
  const me = sellerIdOf(user);
  const since = Date.now() - CLOSED_DAYS * 86_400_000;
  const [snap, sellers] = await Promise.all([adminDb.collection(dealsCol(user.uid)).orderBy("updatedAt", "desc").limit(1000).get(), listSellers(user.uid)]);
  const deals = snap.docs
    .filter((d) => all || !d.get("assigneeId") || d.get("assigneeId") === me)
    .filter((d) => !["vendido", "perdido"].includes(d.get("stage")) || ((d.get("stageChangedAt") as Timestamp | undefined)?.toMillis() ?? 0) > since)
    .map((d) => toDealRow(d.id, d.data()));
  return NextResponse.json({ deals, sellers, me });
});

export const POST = withPerm("deals.edit", async (req, user) => {
  const ref = await createDealFor(user.uid, user, (await req.json()) as Record<string, unknown>);
  return NextResponse.json({ deal: toDealRow(ref.id, (await ref.get()).data()!) }, { status: 201 });
});
