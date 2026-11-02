import { NextResponse } from "next/server";
import { withPerm } from "@/lib/auth-guard";
import { adminDb } from "@/lib/firebase/admin";
import { clientsCol } from "@/lib/firebase/paths";
import { toClientRow } from "@/lib/clients";

// Contacts registered by the webhook (comments and DMs), most recent first.
export const GET = withPerm("clients", async (_req, user) => {
  const snap = await adminDb.collection(clientsCol(user.uid)).orderBy("lastContactAt", "desc").limit(2000).get();
  return NextResponse.json({ clients: snap.docs.map((d) => toClientRow(d.id, d.data())) });
});
