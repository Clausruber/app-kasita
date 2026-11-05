import { Router, Response } from "express";
import { Timestamp, FieldValue, getFirestore } from "firebase-admin/firestore";
import { authRequired, AuthenticatedRequest } from "../api_middleware";
import { tasksCol, taskDoc } from "../paths";
import { sellerIdOf } from "../lib/deals-server";
import { canSeeTask, parseTaskInput, toTaskRow } from "../lib/tasks-server";

export const tasksRouter = Router();

const DONE_DAYS = 14;

tasksRouter.get("/", authRequired({ perm: "tasks" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const since = Date.now() - DONE_DAYS * 86_400_000;
    const db = getFirestore();
    const snap = await db.collection(tasksCol(user.uid)).orderBy("dueAt", "asc").limit(2000).get();
    const tasks = snap.docs
      .filter((d) => canSeeTask(user as any, d.data()))
      .filter((d) => !d.get("done") || ((d.get("doneAt") as Timestamp | undefined)?.toMillis() ?? 0) > since)
      .map((d) => toTaskRow(d.id, d.data()));
    return res.json({ tasks, me: sellerIdOf(user as any) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

tasksRouter.post("/", authRequired({ perm: "tasks" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const body = (req.body || {}) as Record<string, unknown>;
    const data = parseTaskInput(user as any, { assigneeId: sellerIdOf(user as any), ...body }, true);
    const db = getFirestore();
    const ref = await db.collection(tasksCol(user.uid)).add({
      notes: "",
      done: false,
      doneAt: null,
      kind: "manual",
      ...data,
      createdBy: user.actor.authUid,
      createdAt: FieldValue.serverTimestamp(),
    });
    return res.status(201).json({ task: toTaskRow(ref.id, (await ref.get()).data()!) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

tasksRouter.patch("/:id", authRequired({ perm: "tasks" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const id = req.params.id as string;
    const db = getFirestore();
    const ref = db.doc(taskDoc(user.uid, id));
    const snap = await ref.get();
    if (!snap.exists || !canSeeTask(user as any, snap.data()!)) {
      return res.status(404).json({ error: "Tarea no encontrada" });
    }
    await ref.update(parseTaskInput(user as any, req.body || {}, false));
    return res.json({ task: toTaskRow(id, (await ref.get()).data()!) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

tasksRouter.delete("/:id", authRequired({ perm: "tasks" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const id = req.params.id as string;
    const db = getFirestore();
    const ref = db.doc(taskDoc(user.uid, id));
    const snap = await ref.get();
    if (!snap.exists || !canSeeTask(user as any, snap.data()!)) {
      return res.status(404).json({ error: "Tarea no encontrada" });
    }
    if (snap.get("kind") !== "manual") {
      await ref.update({ done: true, doneAt: FieldValue.serverTimestamp() });
    } else {
      await ref.delete();
    }
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

