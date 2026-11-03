import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { withPerm } from "@/lib/auth-guard";
import { adminDb } from "@/lib/firebase/admin";
import { tasksCol } from "@/lib/firebase/paths";
import { sellerIdOf } from "@/lib/deals-server";
import { canSeeTask, parseTaskInput, toTaskRow } from "@/lib/tasks-server";

// Done tasks stay listed this long.
const DONE_DAYS = 14;

// Pending follow-ups plus the recently completed ones (filters by person are applied here).
export const GET = withPerm("tasks", async (_req, user) => {
  const since = Date.now() - DONE_DAYS * 86_400_000;
  const snap = await adminDb.collection(tasksCol(user.uid)).orderBy("dueAt", "asc").limit(2000).get();
  const tasks = snap.docs
    .filter((d) => canSeeTask(user, d.data()))
    .filter((d) => !d.get("done") || ((d.get("doneAt") as Timestamp | undefined)?.toMillis() ?? 0) > since)
    .map((d) => toTaskRow(d.id, d.data()));
  return NextResponse.json({ tasks, me: sellerIdOf(user) });
});

export const POST = withPerm("tasks", async (req, user) => {
  const body = (await req.json()) as Record<string, unknown>;
  const data = parseTaskInput(user, { assigneeId: sellerIdOf(user), ...body }, true);
  const ref = await adminDb.collection(tasksCol(user.uid)).add({
    notes: "",
    done: false,
    doneAt: null,
    kind: "manual",
    ...data,
    createdBy: user.actor.authUid,
    createdAt: FieldValue.serverTimestamp(),
  });
  return NextResponse.json({ task: toTaskRow(ref.id, (await ref.get()).data()!) }, { status: 201 });
});
