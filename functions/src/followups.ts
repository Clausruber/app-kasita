import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { conversationsCol, taskDoc, tenantsCol, userDoc, vehiclesCol } from "./paths";

// Automatic follow-ups: DMs left without an answer and apartados about to expire.
// Task ids are deterministic, so running twice never duplicates a reminder (and a dismissed one
// stays dismissed: the web marks automatic tasks done instead of deleting them).

const db = () => getFirestore();
const DEFAULT_STALE_HOURS = 4;
const LOOKBACK_HOURS = 72; // older silences are not worth a reminder anymore
const HOUR = 3600_000;

async function createOnce(path: string, data: object) {
  try {
    await db().doc(path).create({ ...data, done: false, doneAt: null, notes: "", createdAt: FieldValue.serverTimestamp() });
    return 1;
  } catch (e) {
    if ((e as { code?: number }).code === 6) return 0; // ALREADY_EXISTS
    throw e;
  }
}

async function staleLeads(uid: string, staleHours: number) {
  const now = Date.now();
  // Single-field range: no composite index needed; the direction is checked in memory.
  const snap = await db()
    .collection(conversationsCol(uid))
    .where("lastInboundAt", ">=", Timestamp.fromMillis(now - LOOKBACK_HOURS * HOUR))
    .where("lastInboundAt", "<=", Timestamp.fromMillis(now - staleHours * HOUR))
    .get();
  let n = 0;
  for (const c of snap.docs) {
    if (c.get("lastDirection") !== "in") continue;
    const at = c.get("lastInboundAt") as Timestamp;
    const name = c.get("participant.name") || "un cliente";
    n += await createOnce(taskDoc(uid, `stale_${c.id}_${at.toMillis()}`), {
      title: `Responder a ${name}: lleva más de ${staleHours} h sin respuesta`,
      dueAt: Timestamp.now(),
      assigneeId: null,
      clientId: null,
      dealId: null,
      vehicleId: null,
      conversationId: c.id,
      kind: "stale_lead",
    });
  }
  return n;
}

async function expiringReservations(uid: string) {
  const soon = Date.now() + 24 * HOUR;
  const snap = await db().collection(vehiclesCol(uid)).where("status", "==", "apartado").get();
  let n = 0;
  for (const v of snap.docs) {
    const r = v.get("reservation");
    const exp = (r?.expiresAt as Timestamp | undefined)?.toMillis();
    if (!r?.dealId || !exp || exp > soon) continue;
    // Same id the web uses when the apartado is created: only fills the gap if that one is missing.
    n += await createOnce(taskDoc(uid, `reservation_${r.dealId}`), {
      title: `Vence apartado: ${v.get("title") || "auto"}`,
      dueAt: Timestamp.fromMillis(exp),
      assigneeId: null,
      clientId: null,
      dealId: r.dealId,
      vehicleId: v.id,
      conversationId: null,
      kind: "reservation_expiry",
    });
  }
  return n;
}

/** "Bloquear" notices ending within the next hour (+ a margin for the hourly schedule): warn their seller. */
async function expiringHolds(uid: string, timezone: string) {
  const now = Date.now();
  // Single-field range: no composite index; already-expired holds are skipped in memory.
  const snap = await db()
    .collection(vehiclesCol(uid))
    .where("hold.until", "<=", Timestamp.fromMillis(now + 70 * 60_000))
    .get();
  const time = new Intl.DateTimeFormat("es-MX", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  let n = 0;
  for (const v of snap.docs) {
    const until = (v.get("hold.until") as Timestamp | undefined)?.toMillis();
    if (!until || until <= now || !["disponible", "apartado"].includes(v.get("status"))) continue;
    n += await createOnce(taskDoc(uid, `hold_${v.id}_${until}`), {
      title: `Tu bloqueo del ${v.get("title") || "auto"} vence a las ${time.format(new Date(until))}`,
      dueAt: Timestamp.fromMillis(until),
      assigneeId: (v.get("hold.byId") as string | undefined) || null,
      clientId: null,
      dealId: null,
      vehicleId: v.id,
      conversationId: null,
      kind: "hold_expiry",
    });
  }
  return n;
}

export const alFlagStaleLeads = onSchedule("every 60 minutes", async () => {
  const tenants = await db().collection(tenantsCol()).where("status", "==", "active").get();
  let created = 0;
  for (const t of tenants.docs) {
    try {
      const user = await db().doc(userDoc(t.id)).get();
      const hours = Number(user.get("followUp.staleHours")) || DEFAULT_STALE_HOURS;
      created += await staleLeads(t.id, hours);
      created += await expiringReservations(t.id);
      created += await expiringHolds(t.id, (user.get("company.timezone") as string | undefined) || "America/Mexico_City");
    } catch (err) {
      logger.warn("follow-ups failed", { uid: t.id, err: String(err) });
    }
  }
  if (created) logger.info("follow-up tasks created", { created });
});
