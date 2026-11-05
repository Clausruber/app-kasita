import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpError, withPerm } from "@/lib/auth-guard";
import { actorCan } from "@/lib/actor";
import { listSellers, sellerIdOf } from "@/lib/deals-server";
import { adminDb } from "@/lib/firebase/admin";
import { propertyDoc } from "@/lib/firebase/paths";
import { holdOf, toPropertyRow } from "@/lib/properties";

type Ctx = { params: Promise<{ id: string }> };

const HOLD_HOURS = [2, 4, 24, 48, 72] as const; // same options as components/inventory/hold-dialog.tsx

// "Bloquear": an internal notice that an agent is showing the property until a time. It blocks nothing
// (quotes, reservations and sales still work); it expires by itself and the scheduler warns 1 h before.

export const POST = withPerm<Ctx>("inventory", async (req, user, { params }) => {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { hours?: unknown; note?: unknown };
  const hours = Number(body.hours);
  if (!(HOLD_HOURS as readonly number[]).includes(hours)) throw new HttpError(400, "Duración no válida");
  const byId = sellerIdOf(user) ?? "";
  const byName = (await listSellers(user.uid)).find((s) => s.id === byId)?.name ?? user.actor.email ?? "";
  const ref = adminDb.doc(propertyDoc(user.uid, id));
  const previous = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpError(404, "Inmueble no encontrado");
    if (!["disponible", "apartado"].includes(snap.get("status"))) throw new HttpError(409, "Solo se pueden bloquear inmuebles disponibles o apartados");
    const current = holdOf(snap.get("hold"));
    tx.update(ref, {
      hold: {
        byId,
        byName,
        until: Timestamp.fromMillis(Date.now() + hours * 3_600_000),
        note: typeof body.note === "string" ? body.note.trim().slice(0, 200) : "",
        at: FieldValue.serverTimestamp(),
      },
    });
    return current && current.byId !== byId ? current : null;
  });
  const showPrivate = actorCan(user.actor, "inventory.private");
  return NextResponse.json({ property: toPropertyRow(id, (await ref.get()).data()!, showPrivate), previous });
});

/** Releases the hold: whoever set it, or anyone who can edit the inventory. */
export const DELETE = withPerm<Ctx>("inventory", async (_req, user, { params }) => {
  const { id } = await params;
  const ref = adminDb.doc(propertyDoc(user.uid, id));
  const snap = await ref.get();
  if (!snap.exists) throw new HttpError(404, "Inmueble no encontrado");
  const current = holdOf(snap.get("hold"));
  if (current && current.byId !== sellerIdOf(user) && !actorCan(user.actor, "inventory.edit"))
    throw new HttpError(403, `Solo ${current.byName || "quien lo bloqueó"} o un supervisor puede liberarlo`);
  await ref.update({ hold: FieldValue.delete() });
  return NextResponse.json({ property: toPropertyRow(id, (await ref.get()).data()!, actorCan(user.actor, "inventory.private")) });
});
