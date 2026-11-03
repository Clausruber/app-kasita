import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { agendaDayDoc, agendaDoc, agendasCol, bookingsCol, quoteDoc, quoteTokenDoc, taskDoc, tenantsCol } from "./paths";
import { workspaceOf } from "./actor";
import { type BookingClientInput, findBookingClient, saveBookingClient } from "./clients";
import { bookingVehicle } from "./inventory";

const db = () => getFirestore();

export const HOLD_MS = 2 * 3600_000; // a booking proposed in a draft is held this long
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
type Weekday = (typeof WEEKDAYS)[number];
type Range = { start: string; end: string }; // "HH:mm" in the agenda's timezone

export type Agenda = {
  id: string;
  name: string;
  service: string;
  description: string;
  price: string;
  durationMin: number;
  bufferMin: number;
  timezone: string;
  weekly: Partial<Record<Weekday, Range[]>>;
  blockedDates: string[];
  minNoticeMin: number;
  maxDaysAhead: number;
  active: boolean;
  lanes: number; // parallel bookings per time (sub-spaces A, B, C…)
  vehicleRequired: boolean; // test drives: every booking says which car
};
export type BookingStatus = "held" | "confirmed" | "cancelled" | "expired";
// Entry of a day's lock doc: times in epoch ms.
export type Busy = { start: number; end: number; status: BookingStatus; holdExpiresAt?: number | null; lane?: string; vehicleId?: string | null };
export type Customer = { name: string; platform?: string | null; authorId?: string | null; username?: string | null; contact?: string | null };
export type Channel = { kind: "comment" | "dm" | "admin" | "quote"; postId?: string; messageId?: string; conversationId?: string; quoteId?: string };
export type Slot = { start: number; end: number; date: string; time: string; lanes: string[] }; // lanes still free
export type BookingVehicle = { id: string; title: string };

export const LANE_NAMES = "ABCDEF";
export const MAX_LANES = LANE_NAMES.length;
const lanesOf = (agenda: Agenda) => LANE_NAMES.slice(0, Math.min(Math.max(agenda.lanes, 1), MAX_LANES)).split("");
// Bookings made before sub-spaces existed sit in space A.
const laneOf = (b: Busy) => b.lane || "A";

export class SlotTakenError extends Error {
  constructor(public alternatives: Slot[]) {
    super("slot_taken");
  }
}

// ---------- timezone helpers (Intl only) ----------

function parts(ms: number, tz: string) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

const offsetMs = (ms: number, tz: string) => {
  const p = parts(ms, tz);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
};

/** Wall-clock date + minutes-of-day in `tz` → epoch ms (handles DST). */
export function zonedToUtc(date: string, minutes: number, tz: string) {
  const [y, mo, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, mo - 1, d, 0, minutes);
  const first = guess - offsetMs(guess, tz);
  return guess - offsetMs(first, tz);
}

/** Epoch ms → { date: "YYYY-MM-DD", time: "HH:mm" } in `tz`. */
export function localDateTime(ms: number, tz: string) {
  const p = parts(ms, tz);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { date: `${p.y}-${pad(p.mo)}-${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.mi)}` };
}

export const isValidTimezone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const weekdayOf = (date: string) => {
  const [y, mo, d] = date.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
};
const addDays = (date: string, n: number) => {
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d + n)).toISOString().slice(0, 10);
};

/** Human label in Spanish, e.g. "mar 4 nov, 10:00". */
export function formatSlot(ms: number, tz: string) {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(ms));
}

// ---------- availability ----------

/** A busy entry still blocks its time: confirmed, or a hold that has not expired. */
export const isActive = (b: Busy, now: number) =>
  b.status === "confirmed" || (b.status === "held" && (b.holdExpiresAt ?? 0) > now);

/**
 * Free slots of `date` (YYYY-MM-DD in the agenda's timezone): the weekly ranges cut into
 * duration+buffer steps, minus past/too-soon/too-far slots and blocked dates. A slot stays free while
 * one of its sub-spaces (A, B…) has no overlapping booking and, if `vehicleId` is given, that car is
 * not already booked at that time.
 */
export function computeSlots(agenda: Agenda, date: string, busy: Busy[], now: number, vehicleId?: string | null): Slot[] {
  const tz = agenda.timezone;
  const today = localDateTime(now, tz).date;
  if (date < today || date > addDays(today, agenda.maxDaysAhead) || agenda.blockedDates.includes(date)) return [];
  const dur = agenda.durationMin * 60_000;
  const buf = agenda.bufferMin * 60_000;
  const step = agenda.durationMin + agenda.bufferMin;
  const earliest = now + agenda.minNoticeMin * 60_000;
  const active = busy.filter((b) => isActive(b, now));

  const slots: Slot[] = [];
  for (const r of agenda.weekly[weekdayOf(date)] ?? []) {
    for (let t = toMin(r.start); t + agenda.durationMin <= toMin(r.end); t += step) {
      const start = zonedToUtc(date, t, tz);
      const local = localDateTime(start, tz);
      // Wall times skipped by a DST change do not exist.
      if (local.date !== date || toMin(local.time) !== t) continue;
      if (start < earliest) continue;
      // Buffer around existing bookings too, so off-grid bookings (duration changed later) still fit.
      const overlapping = active.filter((b) => start < b.end + buf && b.start < start + dur + buf);
      if (vehicleId && overlapping.some((b) => b.vehicleId === vehicleId)) continue;
      const lanes = lanesOf(agenda).filter((l) => !overlapping.some((b) => laneOf(b) === l));
      if (!lanes.length) continue;
      slots.push({ start, end: start + dur, ...local, lanes });
    }
  }
  return slots.sort((a, b) => a.start - b.start);
}

// ---------- persistence ----------

export function parseAgenda(id: string, d: FirebaseFirestore.DocumentData | undefined): Agenda | null {
  if (!d) return null;
  return {
    id,
    name: d.name ?? d.service ?? "",
    service: d.service ?? d.name ?? "",
    description: d.description ?? "",
    price: d.price ?? "",
    durationMin: Number(d.durationMin) || 30,
    bufferMin: Number(d.bufferMin) || 0,
    timezone: isValidTimezone(d.timezone) ? d.timezone : "UTC",
    weekly: d.weekly ?? {},
    blockedDates: Array.isArray(d.blockedDates) ? d.blockedDates : [],
    minNoticeMin: Number(d.minNoticeMin) || 0,
    maxDaysAhead: Number(d.maxDaysAhead) || 60,
    active: d.active !== false,
    lanes: Math.min(Math.max(Number(d.lanes) || 1, 1), MAX_LANES),
    vehicleRequired: Boolean(d.vehicleRequired),
  };
}

const busyOf = (day: FirebaseFirestore.DocumentSnapshot) =>
  Object.entries((day.get("busy") ?? {}) as Record<string, Busy>).map(([id, b]) => ({ id, ...b }));

export async function getAgenda(uid: string, agendaId: string) {
  const snap = await db().doc(agendaDoc(uid, agendaId)).get();
  return parseAgenda(snap.id, snap.data());
}

export async function listAgendas(uid: string, onlyActive = true) {
  const snap = await db().collection(agendasCol(uid)).get();
  return snap.docs.map((d) => parseAgenda(d.id, d.data())!).filter((a) => !onlyActive || a.active);
}

export async function getSlots(uid: string, agenda: Agenda, date: string, now = Date.now(), vehicleId?: string | null) {
  const day = await db().doc(agendaDayDoc(uid, agenda.id, date)).get();
  return computeSlots(agenda, date, busyOf(day), now, vehicleId);
}

/** Next free slots from `date` on (for "that time is taken, what about…"). */
export async function nearestSlots(uid: string, agenda: Agenda, date: string, max = 5, vehicleId?: string | null) {
  const out: Slot[] = [];
  for (let i = 0; i < 14 && out.length < max; i++) out.push(...(await getSlots(uid, agenda, addDays(date, i), Date.now(), vehicleId)));
  return out.slice(0, max);
}

/**
 * Books one slot. A transaction on the day's lock doc serialises concurrent bookings (agent and admin),
 * so a slot can never be given twice. Throws SlotTakenError (with alternatives) if it is no longer free.
 */
export async function reserveSlot(
  uid: string,
  agendaId: string,
  date: string,
  time: string,
  opts: {
    status: "held" | "confirmed";
    customer: Customer;
    channel: Channel;
    source: "ai" | "admin";
    notes?: string;
    lane?: string; // a specific sub-space; otherwise the first free one
    vehicle?: BookingVehicle | null;
  },
) {
  const agendaRef = db().doc(agendaDoc(uid, agendaId));
  const dayRef = db().doc(agendaDayDoc(uid, agendaId, date));
  const bookingRef = db().collection(bookingsCol(uid)).doc();
  const now = Date.now();

  const result = await db().runTransaction(async (tx) => {
    const [agendaSnap, daySnap] = await Promise.all([tx.get(agendaRef), tx.get(dayRef)]);
    const agenda = parseAgenda(agendaSnap.id, agendaSnap.data());
    if (!agenda || !agenda.active) throw new HttpsError("not-found", "Agenda no encontrada o inactiva");
    if (agenda.vehicleRequired && !opts.vehicle) throw new HttpsError("invalid-argument", "Indica el auto de la prueba de manejo");
    const vehicleId = opts.vehicle?.id ?? null;
    const free = computeSlots(agenda, date, busyOf(daySnap), now, vehicleId);
    const slot = free.find((s) => s.time === time);
    const lane = opts.lane ? slot?.lanes.find((l) => l === opts.lane) : slot?.lanes[0];
    if (!slot || !lane) return { taken: true as const, agenda };

    const holdExpiresAt = opts.status === "held" ? now + HOLD_MS : null;
    tx.set(
      dayRef,
      { busy: { [bookingRef.id]: { start: slot.start, end: slot.end, status: opts.status, holdExpiresAt, lane, vehicleId } } },
      { merge: true },
    );
    tx.set(bookingRef, {
      uid,
      agendaId,
      service: agenda.service,
      timezone: agenda.timezone,
      date,
      time,
      start: Timestamp.fromMillis(slot.start),
      end: Timestamp.fromMillis(slot.end),
      status: opts.status,
      holdExpiresAt: holdExpiresAt ? Timestamp.fromMillis(holdExpiresAt) : null,
      customer: opts.customer,
      channel: opts.channel,
      source: opts.source,
      notes: opts.notes ?? "",
      lane: agenda.lanes > 1 ? lane : null,
      vehicle: opts.vehicle ?? null,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { taken: false as const, agenda, slot, lane };
  });

  if (result.taken) throw new SlotTakenError(await nearestSlots(uid, result.agenda, date, 5, opts.vehicle?.id));
  return {
    id: bookingRef.id,
    agendaId,
    service: result.agenda.service,
    start: result.slot.start,
    label: formatSlot(result.slot.start, result.agenda.timezone),
    status: opts.status,
    lane: result.agenda.lanes > 1 ? result.lane : null,
    vehicle: opts.vehicle ?? null,
  };
}

/** Turns a hold into a confirmed booking (re-checking the slot if the hold already expired). */
export async function confirmBooking(uid: string, bookingId: string) {
  const ref = db().collection(bookingsCol(uid)).doc(bookingId);
  await db().runTransaction(async (tx) => {
    const b = await tx.get(ref);
    if (!b.exists) throw new HttpsError("not-found", "Reserva no encontrada");
    if (b.get("status") === "confirmed") return;
    if (!["held", "expired"].includes(b.get("status"))) throw new HttpsError("failed-precondition", "La reserva ya no está activa");
    const dayRef = db().doc(agendaDayDoc(uid, b.get("agendaId"), b.get("date")));
    const day = await tx.get(dayRef);
    const start = (b.get("start") as Timestamp).toMillis();
    const end = (b.get("end") as Timestamp).toMillis();
    const now = Date.now();
    // Same sub-space, or the same car in any sub-space, at an overlapping time.
    const lane = (b.get("lane") as string | null) || "A";
    const vehicleId = (b.get("vehicle.id") as string | undefined) ?? null;
    const clash = busyOf(day).some(
      (x) => x.id !== bookingId && isActive(x, now) && start < x.end && x.start < end && (laneOf(x) === lane || (!!vehicleId && x.vehicleId === vehicleId)),
    );
    if (clash) throw new HttpsError("already-exists", "Ese horario ya fue reservado por otra persona");
    tx.set(dayRef, { busy: { [bookingId]: { start, end, status: "confirmed", holdExpiresAt: null, lane, vehicleId } } }, { merge: true });
    tx.update(ref, { status: "confirmed", holdExpiresAt: null, confirmedAt: FieldValue.serverTimestamp() });
  });
}

/** Cancels (or expires) a booking and frees its slot. */
export async function cancelBooking(uid: string, bookingId: string, status: "cancelled" | "expired" = "cancelled", onlyHeld = status === "expired") {
  const ref = db().collection(bookingsCol(uid)).doc(bookingId);
  await db().runTransaction(async (tx) => {
    const b = await tx.get(ref);
    if (!b.exists) throw new HttpsError("not-found", "Reserva no encontrada");
    if (["cancelled", "expired"].includes(b.get("status"))) return;
    if (onlyHeld && b.get("status") !== "held") return;
    tx.update(db().doc(agendaDayDoc(uid, b.get("agendaId"), b.get("date"))), { [`busy.${bookingId}`]: FieldValue.delete() });
    tx.update(ref, { status, cancelledAt: FieldValue.serverTimestamp() });
  });
}

/** Frees a slot proposed in a draft that was discarded (no-op once confirmed). */
export const releaseHold = (uid: string, bookingId: string) => cancelBooking(uid, bookingId, "cancelled", true);

/** Upcoming active bookings of one social user (for the agent's context). */
export async function customerBookings(uid: string, authorId: string) {
  const snap = await db().collection(bookingsCol(uid)).where("customer.authorId", "==", authorId).get();
  const now = Date.now();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as FirebaseFirestore.DocumentData & { id: string })
    .filter((b) => (b.start as Timestamp).toMillis() > now && (b.status === "confirmed" || b.status === "held"))
    .sort((a, b) => (a.start as Timestamp).toMillis() - (b.start as Timestamp).toMillis());
}

// ---------- callables (Agenda page) ----------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

export const alGetSlots = onCall(async (req) => {
  const uid = await workspaceOf(req, "agenda");
  const { agendaId, date, vehicleId } = req.data as { agendaId?: string; date?: string; vehicleId?: string };
  if (!agendaId || !date || !DATE_RE.test(date)) throw new HttpsError("invalid-argument", "Faltan agendaId o date");
  const agenda = await getAgenda(uid, agendaId);
  if (!agenda) throw new HttpsError("not-found", "Agenda no encontrada");
  // With a car chosen, times when that car already has a test drive are not offered.
  const slots = await getSlots(uid, agenda, date, Date.now(), vehicleId || null);
  return { timezone: agenda.timezone, slots: slots.map((s) => ({ ...s, label: formatSlot(s.start, agenda.timezone) })) };
});

/**
 * Booking from the Agenda page / "Agendar" modal. The booking is linked to a client: the chosen one,
 * the one with that WhatsApp, or a new manual client (created only once the slot is secured).
 */
export const alBookSlot = onCall(async (req) => {
  const uid = await workspaceOf(req, "agenda.book");
  const { agendaId, date, time, customer, notes, vehicleId, lane } = req.data as {
    agendaId?: string;
    date?: string;
    time?: string;
    customer?: BookingClientInput;
    notes?: string;
    vehicleId?: string;
    lane?: string;
  };
  if (!agendaId || !date || !DATE_RE.test(date) || !time || !TIME_RE.test(time)) throw new HttpsError("invalid-argument", "Datos de reserva incompletos");
  if (!customer?.clientId && !customer?.firstName?.trim()) throw new HttpsError("invalid-argument", "Indica el nombre del cliente");
  let vehicle: BookingVehicle | null = null;
  if (vehicleId) {
    const v = await bookingVehicle(uid, vehicleId);
    if ("error" in v) throw new HttpsError("invalid-argument", v.error);
    vehicle = v;
  }
  const client = await findBookingClient(uid, customer).catch((e: Error) => {
    throw new HttpsError("invalid-argument", e.message);
  });
  try {
    const booking = await reserveSlot(uid, agendaId, date, time, {
      status: "confirmed",
      customer: { name: client.name, platform: client.platform, authorId: client.authorId, contact: client.whatsapp },
      channel: { kind: "admin" },
      source: "admin",
      notes: notes?.trim().slice(0, 1000),
      lane: typeof lane === "string" && LANE_NAMES.includes(lane) && lane.length === 1 ? lane : undefined,
      vehicle,
    });
    await saveBookingClient(uid, client, [booking.service, vehicle?.title, booking.label].filter(Boolean).join(" · "));
    return { ...booking, client: { id: client.ref.id, name: client.name, created: client.created } };
  } catch (e) {
    if (e instanceof SlotTakenError) throw new HttpsError("already-exists", "Ese horario ya no está disponible");
    throw e;
  }
});

export const alConfirmBooking = onCall(async (req) => {
  const uid = await workspaceOf(req, "agenda.book");
  const { bookingId } = req.data as { bookingId?: string };
  if (!bookingId) throw new HttpsError("invalid-argument", "Falta bookingId");
  await confirmBooking(uid, bookingId);
  return { ok: true };
});

export const alCancelBooking = onCall(async (req) => {
  const uid = await workspaceOf(req, "agenda.book");
  const { bookingId } = req.data as { bookingId?: string };
  if (!bookingId) throw new HttpsError("invalid-argument", "Falta bookingId");
  await cancelBooking(uid, bookingId);
  return { ok: true };
});

/** Frees expired holds (drafts nobody sent). Availability already ignores them; this tidies the data. */
export const alExpireHolds = onSchedule("every 60 minutes", async () => {
  const now = Date.now();
  const tenants = await db().collection(tenantsCol()).get();
  let n = 0;
  for (const t of tenants.docs) {
    const held = await db().collection(bookingsCol(t.id)).where("status", "==", "held").get();
    for (const b of held.docs) {
      if (((b.get("holdExpiresAt") as Timestamp | null)?.toMillis() ?? 0) > now) continue;
      await cancelBooking(t.id, b.id, "expired").catch((err) => logger.warn("expire failed", { uid: t.id, id: b.id, err: String(err) }));
      n++;
    }
  }
  if (n) logger.info("holds expired", { n });
});

// ---------- public quote page (/c/{token}): test drives without login ----------

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** Token → quote, rejecting unknown, expired or wrong-car requests. The token is the only credential. */
async function quoteForBooking(token: unknown, vehicleId: unknown) {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) throw new HttpsError("not-found", "Cotización no encontrada");
  const idx = await db().doc(quoteTokenDoc(token)).get();
  const uid = idx.get("uid") as string | undefined;
  const quoteId = idx.get("quoteId") as string | undefined;
  if (!uid || !quoteId) throw new HttpsError("not-found", "Cotización no encontrada");
  const ref = db().doc(quoteDoc(uid, quoteId));
  const q = await ref.get();
  if (!q.exists) throw new HttpsError("not-found", "Cotización no encontrada");
  const created = (q.get("createdAt") as Timestamp | null)?.toMillis() ?? 0;
  if (created + (Number(q.get("validDays")) || 7) * 86_400_000 < Date.now()) throw new HttpsError("failed-precondition", "La cotización ya venció; escríbenos por WhatsApp");
  const vehicles = (q.get("vehicles") ?? []) as { id: string }[];
  if (typeof vehicleId !== "string" || !vehicles.some((v) => v.id === vehicleId)) throw new HttpsError("invalid-argument", "Ese auto no está en la cotización");
  const agendas = await listAgendas(uid);
  const agenda = agendas.find((a) => a.vehicleRequired);
  if (!agenda) throw new HttpsError("failed-precondition", "No hay agenda de pruebas de manejo");
  return { uid, quoteId, ref, q, agenda, vehicleId };
}

export const alQuoteSlots = onCall(async (req) => {
  const { token, vehicleId, date } = (req.data ?? {}) as { token?: string; vehicleId?: string; date?: string };
  if (!date || !DATE_RE.test(date)) throw new HttpsError("invalid-argument", "Fecha no válida");
  const { uid, agenda } = await quoteForBooking(token, vehicleId);
  const slots = await getSlots(uid, agenda, date, Date.now(), vehicleId);
  return { timezone: agenda.timezone, slots: slots.map((s) => ({ time: s.time, label: formatSlot(s.start, agenda.timezone) })) };
});

/** One active test drive per quote; the booking is confirmed and the seller gets a follow-up. */
export const alQuoteBook = onCall(async (req) => {
  const { token, vehicleId, date, time, name, whatsapp } = (req.data ?? {}) as Record<string, string | undefined>;
  if (!date || !DATE_RE.test(date) || !time || !TIME_RE.test(time)) throw new HttpsError("invalid-argument", "Elige día y hora");
  if (!name?.trim()) throw new HttpsError("invalid-argument", "Indica tu nombre");
  const { uid, quoteId, ref, q, agenda } = await quoteForBooking(token, vehicleId);
  // Empty = the WhatsApp saved with the quote (the page only shows its last digits).
  const phone = (whatsapp ?? "").trim() || ((q.get("clientWhatsapp") as string | undefined) ?? "");
  if (phone.replace(/\D/g, "").length < 8) throw new HttpsError("invalid-argument", "Indica tu WhatsApp");
  const prev = q.get("bookingId") as string | null;
  if (prev) {
    const b = await db().collection(bookingsCol(uid)).doc(prev).get();
    if (["held", "confirmed"].includes(b.get("status"))) throw new HttpsError("already-exists", "Ya tienes una prueba de manejo agendada con esta cotización");
  }
  const vehicle = await bookingVehicle(uid, vehicleId);
  if ("error" in vehicle) throw new HttpsError("failed-precondition", vehicle.error);
  const [firstName, ...rest] = name.trim().split(/\s+/);
  const clientId = (q.get("clientId") as string | null) ?? undefined;
  const client = await findBookingClient(uid, { clientId, firstName, lastName: rest.join(" "), whatsapp: phone }).catch((e: Error) => {
    throw new HttpsError("invalid-argument", e.message);
  });
  try {
    const booking = await reserveSlot(uid, agenda.id, date, time, {
      status: "confirmed",
      customer: { name: client.name, platform: client.platform, authorId: client.authorId, contact: client.whatsapp },
      channel: { kind: "quote", quoteId },
      source: "admin",
      notes: `Agendada por el cliente desde la cotización ${q.get("folio")}`,
      vehicle,
    });
    await saveBookingClient(uid, client, [booking.service, vehicle.title, booking.label].filter(Boolean).join(" · "));
    await ref.update({ bookingId: booking.id });
    await db().doc(taskDoc(uid, `quote_booking_${quoteId}_${booking.id}`)).set({
      title: `${client.name} agendó ${booking.service.toLowerCase()} del ${vehicle.title}: ${booking.label}`,
      dueAt: Timestamp.fromMillis(booking.start),
      assigneeId: (q.get("sellerId") as string | null) ?? null,
      clientId: client.ref.id,
      dealId: (q.get("dealId") as string | null) ?? null,
      vehicleId: vehicle.id,
      conversationId: (q.get("conversationId") as string | null) ?? null,
      kind: "quote_booking",
      done: false,
      doneAt: null,
      notes: "",
      createdAt: FieldValue.serverTimestamp(),
    });
    return { label: booking.label, lane: booking.lane };
  } catch (e) {
    if (e instanceof SlotTakenError) throw new HttpsError("already-exists", "Ese horario se acaba de ocupar; elige otro");
    throw e;
  }
});
