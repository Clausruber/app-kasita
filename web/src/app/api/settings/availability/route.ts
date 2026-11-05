import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { withUser, type ApiUser } from "@/lib/auth-guard";
import { parseAvailability } from "@/lib/agendas";
import { adminDb } from "@/lib/firebase/admin";
import { memberDoc, userDoc } from "@/lib/firebase/paths";

// "Mi horario de visitas": the signed-in agent's own hours for staffed agendas. Owners keep it on the
// workspace doc, team members on their member record (read by functions/src/agenda.ts → agentsOf).
const refOf = (user: ApiUser) => adminDb.doc(user.actor.isOwner ? userDoc(user.actor.uid) : memberDoc(user.actor.uid, user.actor.memberId!));

export const GET = withUser(async (_req, user) => {
  const a = (await refOf(user).get()).get("availability");
  return NextResponse.json({ availability: a ? parseAvailability(a) : { weekly: null, blockedDates: [] } });
});

export const PUT = withUser(async (req, user) => {
  const availability = parseAvailability(await req.json());
  await refOf(user).set({ availability, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return NextResponse.json({ availability });
});
