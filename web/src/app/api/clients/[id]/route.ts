import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpError, withPerm } from "@/lib/auth-guard";
import { adminDb } from "@/lib/firebase/admin";
import { bookingsCol, clientDoc } from "@/lib/firebase/paths";
import { parseClientEdit, toClientRow } from "@/lib/clients";

type Ctx = { params: Promise<{ id: string }> };

// One client with their bookings (matched by the social user id the agent stores on each booking).
export const GET = withPerm<Ctx>("clients", async (_req, user, { params }) => {
  const { id } = await params;
  const snap = await adminDb.doc(clientDoc(user.uid, id)).get();
  if (!snap.exists) throw new HttpError(404, "Cliente no encontrado");
  const client = toClientRow(snap.id, snap.data()!);
  const bookings = (await adminDb.collection(bookingsCol(user.uid)).where("customer.authorId", "==", client.authorId).get()).docs
    .filter((b) => !b.get("customer.platform") || b.get("customer.platform") === client.platform)
    .map((b) => ({
      id: b.id,
      service: b.get("service") as string,
      start: (b.get("start") as Timestamp).toDate().toISOString(),
      timezone: b.get("timezone") as string,
      status: b.get("status") as string,
    }))
    .sort((a, b) => b.start.localeCompare(a.start));
  return NextResponse.json({ client, bookings });
});

export const PUT = withPerm<Ctx>("clients.edit", async (req, user, { params }) => {
  const { id } = await params;
  const ref = adminDb.doc(clientDoc(user.uid, id));
  const snap = await ref.get();
  if (!snap.exists) throw new HttpError(404, "Cliente no encontrado");
  const data = parseClientEdit(await req.json());
  // A field the owner changes is no longer marked as written by the agent.
  const reviewed = Object.keys(snap.get("aiEdited") ?? {}).filter((k) => k in data && data[k as keyof typeof data] !== (snap.get(k) ?? ""));
  await ref.update({
    ...data,
    ...Object.fromEntries(reviewed.map((k) => [`aiEdited.${k}`, FieldValue.delete()])),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return NextResponse.json({ client: toClientRow(id, (await ref.get()).data()!) });
});
