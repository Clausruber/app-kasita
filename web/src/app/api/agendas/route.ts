import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { withPerm } from "@/lib/auth-guard";
import { adminDb } from "@/lib/firebase/admin";
import { agendasCol } from "@/lib/firebase/paths";
import { parseAgendaInput } from "@/lib/agendas";

// Creates a service agenda. The page reads agendas live from Firestore; slots and bookings go through functions.
export const POST = withPerm("settings.agendas", async (req, user) => {
  const data = parseAgendaInput(await req.json());
  const ref = await adminDb.collection(agendasCol(user.uid)).add({ ...data, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  return NextResponse.json({ id: ref.id });
});
