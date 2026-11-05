
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpError, type ApiUser } from "./auth-guard";
import { actorCan } from "./actor";
import { sellerIdOf } from "./deals-server";
import type { Task } from "./types";

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const iso = (v: unknown) => (v instanceof Timestamp ? v.toDate().toISOString() : null);

export function toTaskRow(id: string, d: FirebaseFirestore.DocumentData): Task {
  return {
    id,
    title: d.title ?? "",
    notes: d.notes ?? "",
    dueAt: iso(d.dueAt) ?? new Date().toISOString(),
    done: Boolean(d.done),
    doneAt: iso(d.doneAt),
    assigneeId: d.assigneeId ?? null,
    clientId: d.clientId ?? null,
    dealId: d.dealId ?? null,
    propertyId: d.propertyId ?? null,
    conversationId: d.conversationId ?? null,
    kind: d.kind ?? "manual",
    createdAt: iso(d.createdAt),
  };
}

/** Members without "tasks.all" see their own tasks and unassigned ones. */
export function canSeeTask(user: ApiUser, d: FirebaseFirestore.DocumentData) {
  return actorCan(user.actor, "tasks.all") || !d.assigneeId || d.assigneeId === sellerIdOf(user);
}

export function parseTaskInput(user: ApiUser, body: Record<string, unknown>, creating: boolean) {
  const out: Record<string, unknown> = {};
  if ("title" in body || creating) {
    out.title = clip(body.title, 200);
    if (!out.title) throw new HttpError(400, "Escribe qué hay que hacer");
  }
  if ("notes" in body) out.notes = clip(body.notes, 2000);
  if ("dueAt" in body || creating) {
    const d = new Date(String(body.dueAt ?? ""));
    if (Number.isNaN(d.getTime())) throw new HttpError(400, "Fecha no válida");
    out.dueAt = Timestamp.fromDate(d);
  }
  if ("done" in body) {
    out.done = Boolean(body.done);
    out.doneAt = body.done ? FieldValue.serverTimestamp() : null;
  }
  if ("assigneeId" in body) {
    const a = body.assigneeId === null || body.assigneeId === "" ? null : String(body.assigneeId);
    if (!actorCan(user.actor, "tasks.all") && a !== null && a !== sellerIdOf(user)) throw new HttpError(403, "Solo puedes asignarte tareas a ti mismo");
    out.assigneeId = a;
  }
  if (creating) for (const k of ["clientId", "dealId", "propertyId", "conversationId"]) out[k] = clip(body[k], 400) || null;
  return out;
}
