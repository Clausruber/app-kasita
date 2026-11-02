import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { HttpError, withPerm } from "@/lib/auth-guard";
import { adminDb } from "@/lib/firebase/admin";
import { agendaDoc, bookingsCol } from "@/lib/firebase/paths";
import { parseAgendaInput } from "@/lib/agendas";

type Ctx = { params: Promise<{ id: string }> };

export const PUT = withPerm<Ctx>("settings.agendas", async (req, user, { params }) => {
  const { id } = await params;
  const ref = adminDb.doc(agendaDoc(user.uid, id));
  if (!(await ref.get()).exists) throw new HttpError(404, "Agenda no encontrada");
  await ref.set({ ...parseAgendaInput(await req.json()), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return NextResponse.json({ id });
});

// Only agendas without upcoming bookings can be deleted (deactivate them otherwise).
export const DELETE = withPerm<Ctx>("settings.agendas", async (_req, user, { params }) => {
  const { id } = await params;
  const ref = adminDb.doc(agendaDoc(user.uid, id));
  const upcoming = await adminDb.collection(bookingsCol(user.uid)).where("agendaId", "==", id).get();
  if (upcoming.docs.some((b) => ["held", "confirmed"].includes(b.get("status")) && b.get("start").toMillis() > Date.now()))
    throw new HttpError(409, "La agenda tiene citas próximas: cancélalas o desactívala");
  await adminDb.recursiveDelete(ref);
  return NextResponse.json({ ok: true });
});
