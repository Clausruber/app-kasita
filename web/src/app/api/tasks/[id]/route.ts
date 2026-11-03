import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { HttpError, withPerm, type ApiUser } from "@/lib/auth-guard";
import { adminDb } from "@/lib/firebase/admin";
import { taskDoc } from "@/lib/firebase/paths";
import { canSeeTask, parseTaskInput, toTaskRow } from "@/lib/tasks-server";

type Ctx = { params: Promise<{ id: string }> };

async function load(user: ApiUser, id: string) {
  const ref = adminDb.doc(taskDoc(user.uid, id));
  const snap = await ref.get();
  if (!snap.exists || !canSeeTask(user, snap.data()!)) throw new HttpError(404, "Tarea no encontrada");
  return ref;
}

export const PATCH = withPerm<Ctx>("tasks", async (req, user, { params }) => {
  const { id } = await params;
  const ref = await load(user, id);
  await ref.update(parseTaskInput(user, await req.json(), false));
  return NextResponse.json({ task: toTaskRow(id, (await ref.get()).data()!) });
});

export const DELETE = withPerm<Ctx>("tasks", async (_req, user, { params }) => {
  const { id } = await params;
  const ref = await load(user, id);
  // Automatic reminders are only closed: the scheduler would recreate a deleted one.
  if ((await ref.get()).get("kind") !== "manual") await ref.update({ done: true, doneAt: FieldValue.serverTimestamp() });
  else await ref.delete();
  return NextResponse.json({ ok: true });
});
