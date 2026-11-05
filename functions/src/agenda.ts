import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { agendaDayDoc, agendaDoc, agendasCol, bookingsCol, membersCol, quoteDoc, quoteTokenDoc, taskDoc, tenantsCol, userDoc } from "./paths";
import { workspaceOf } from "./actor";
import { type BookingClientInput, findBookingClient, saveBookingClient } from "./clients";
import { bookingProperty } from "./inventory";

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
  lanes: number; // parallel bookings per time (sub-spaces A, B, C…); ignored when `agents` is set
  propertyRequired: boolean; // visits: every booking says which property
  // Staffed by people: "all" active agents (owner + members) or a list of their ids. Each booking is then
  // given to one free agent instead of an anonymous sub-space.
  agents: "all" | string[] | null;
};
/** An agent (owner = "owner", else member id) with their own hours; null weekly = the agenda's hours. */
export type AgendaAgent = { id: string; name: string; weekly: Partial<Record<Weekday, Range[]>> | null; blockedDates: string[] };
export type BookingStatus = "held" | "confirmed" | "cancelled" | "expired";
// Entry of a day's lock doc: times in epoch ms.
export type Busy = { start: number; end: number; status: BookingStatus; holdExpiresAt?: number | null; lane?: string; propertyId?: string | null; assigneeId?: string | null };
export type Customer = { name: string; platform?: string | null; authorId?: string | null; username?: string | null; contact?: string | null };
export type Channel = { kind: "comment" | "dm" | "admin" | "quote"; postId?: string; messageId?: string; conversationId?: string; quoteId?: string };
// `lanes`: sub-spaces still free, or (agenda with agents) the ids of the agents still free.
export type Slot = { start: number; end: number; date: string; time: string; lanes: string[] };
export type BookingProperty = { id: string; title: string };

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

/** Who staffs a day: the agenda's agents and the bookings they have that day in other staffed agendas. */
export type Staffing = { agents: AgendaAgent[]; otherBusy: Busy[] };

const withinHours = (ranges: Range[] | undefined, t: number, dur: number) => (ranges ?? []).some((r) => toMin(r.start) <= t && t + dur <= toMin(r.end));

/**
 * Free slots of `date` (YYYY-MM-DD in the agenda's timezone): the weekly ranges cut into
 * duration+buffer steps, minus past/too-soon/too-far slots and blocked dates. A slot stays free while
 * one of its sub-spaces (A, B…) has no overlapping booking and, if `propertyId` is given, that property is
 * not already booked at that time. With `staffing` (agenda with agents) a slot is free while some agent is
 * working then (their own hours, or the agenda's if they set none), is not off that day and has no
 * overlapping booking in any staffed agenda.
 */
export function computeSlots(agenda: Agenda, date: string, busy: Busy[], now: number, propertyId?: string | null, staffing?: Staffing): Slot[] {
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
      if (propertyId && overlapping.some((b) => b.propertyId === propertyId)) continue;
      let lanes: string[];
      if (staffing) {
        const all = [...overlapping, ...staffing.otherBusy.filter((b) => isActive(b, now) && start < b.end + buf && b.start < start + dur + buf)];
        const free = staffing.agents.filter(
          (a) =>
            !a.blockedDates.includes(date) &&
            (a.weekly === null || withinHours(a.weekly[weekdayOf(date)], t, agenda.durationMin)) &&
            !all.some((b) => b.assigneeId === a.id),
        );
        // Bookings from before the agenda had agents have no assignee: each still takes one person.
        const unassigned = overlapping.filter((b) => !b.assigneeId).length;
        lanes = free.slice(0, Math.max(0, free.length - unassigned)).map((a) => a.id);
      } else lanes = lanesOf(agenda).filter((l) => !overlapping.some((b) => laneOf(b) === l));
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
    propertyRequired: Boolean(d.propertyRequired),
    agents: d.agents === "all" ? "all" : Array.isArray(d.agents) ? d.agents.filter((x: unknown) => typeof x === "string") : null,
  };
}

const availabilityOf = (a: FirebaseFirestore.DocumentData | undefined) => ({
  weekly: a?.weekly && typeof a.weekly === "object" ? (a.weekly as Partial<Record<Weekday, Range[]>>) : null,
  blockedDates: Array.isArray(a?.blockedDates) ? (a!.blockedDates as string[]) : [],
});

/** The agents of a staffed agenda: owner + active members (or the agenda's list), each with their hours. */
export async function agentsOf(uid: string, agenda: Agenda): Promise<AgendaAgent[]> {
  if (!agenda.agents) return [];
  const [owner, members] = await Promise.all([db().doc(userDoc(uid)).get(), db().collection(membersCol(uid)).where("status", "==", "active").get()]);
  const all: AgendaAgent[] = [
    { id: "owner", name: (owner.get("displayName") as string) || "Dueño de la cuenta", ...availabilityOf(owner.get("availability")) },
    ...members.docs.map((m) => ({
      id: m.id,
      name: [m.get("firstName"), m.get("lastName")].filter(Boolean).join(" ") || (m.get("email") as string) || "Asesor",
      ...availabilityOf(m.get("availability")),
    })),
  ];
  return agenda.agents === "all" ? all : all.filter((a) => (agenda.agents as string[]).includes(a.id));
}

/** Day docs of the other staffed agendas: an agent cannot be in two visits at once, whatever the agenda. */
async function otherStaffedDays(uid: string, agenda: Agenda, date: string, tx?: FirebaseFirestore.Transaction) {
  const others = (await listAgendas(uid, false)).filter((a) => a.agents && a.id !== agenda.id);
  const refs = others.map((a) => db().doc(agendaDayDoc(uid, a.id, date)));
  const snaps = await Promise.all(refs.map((ref) => (tx ? tx.get(ref) : ref.get())));
  return snaps.map((s) => ({ ref: s.ref, busy: busyOf(s) }));
}

async function staffingOf(uid: string, agenda: Agenda, date: string, tx?: FirebaseFirestore.Transaction): Promise<Staffing | undefined> {
  if (!agenda.agents) return undefined;
  const [agents, days] = await Promise.all([agentsOf(uid, agenda), otherStaffedDays(uid, agenda, date, tx)]);
  return { agents, otherBusy: days.flatMap((d) => d.busy) };
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

export async function getSlots(uid: string, agenda: Agenda, date: string, now = Date.now(), propertyId?: string | null) {
  const [day, staffing] = await Promise.all([db().doc(agendaDayDoc(uid, agenda.id, date)).get(), staffingOf(uid, agenda, date)]);
  return computeSlots(agenda, date, busyOf(day), now, propertyId, staffing);
}

/** Next free slots from `date` on (for "that time is taken, what about…"). */
export async function nearestSlots(uid: string, agenda: Agenda, date: string, max = 5, propertyId?: string | null) {
  const out: Slot[] = [];
  for (let i = 0; i < 14 && out.length < max; i++) out.push(...(await getSlots(uid, agenda, addDays(date, i), Date.now(), propertyId)));
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
    property?: BookingProperty | null;
    assigneeId?: string; // staffed agenda: this agent (if free)
    preferAssigneeIds?: string[]; // staffed agenda: first free of these, else the least busy agent that day
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
    if (agenda.propertyRequired && !opts.property) throw new HttpsError("invalid-argument", "Indica el inmueble a visitar");
    const propertyId = opts.property?.id ?? null;
    const dayBusy = busyOf(daySnap);
    const staffing = await staffingOf(uid, agenda, date, tx);
    const free = computeSlots(agenda, date, dayBusy, now, propertyId, staffing);
    const slot = free.find((s) => s.time === time);
    let lane: string | undefined;
    let assignee: AgendaAgent | null = null;
    if (slot && staffing) {
      // Requested agent; else a preferred one (who already serves this client); else the least busy that day.
      const load = (id: string) => [...dayBusy, ...staffing.otherBusy].filter((b) => b.assigneeId === id && isActive(b, now)).length;
      const id = opts.assigneeId
        ? slot.lanes.find((l) => l === opts.assigneeId)
        : (opts.preferAssigneeIds ?? []).find((p) => slot.lanes.includes(p)) ?? [...slot.lanes].sort((a, b) => load(a) - load(b))[0];
      assignee = staffing.agents.find((a) => a.id === id) ?? null;
      lane = assignee?.id;
    } else lane = opts.lane ? slot?.lanes.find((l) => l === opts.lane) : slot?.lanes[0];
    if (!slot || !lane) return { taken: true as const, agenda };

    const label = formatSlot(slot.start, agenda.timezone);
    // A visit confirmed straight away is a task for its agent (quotes create their own follow-up).
    const taskRef = assignee && opts.status === "confirmed" && opts.channel.kind !== "quote" ? db().doc(taskDoc(uid, `booking_${bookingRef.id}`)) : null;
    const holdExpiresAt = opts.status === "held" ? now + HOLD_MS : null;
    tx.set(
      dayRef,
      {
        busy: {
          [bookingRef.id]: { start: slot.start, end: slot.end, status: opts.status, holdExpiresAt, ...(assignee ? { assigneeId: assignee.id } : { lane }), propertyId },
        },
      },
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
      lane: !assignee && agenda.lanes > 1 ? lane : null,
      assigneeId: assignee?.id ?? null,
      assigneeName: assignee?.name ?? null,
      property: opts.property ?? null,
      createdAt: FieldValue.serverTimestamp(),
    });
    if (taskRef && assignee) tx.set(taskRef, visitTask(assignee.id, slot.start, label, agenda.service, opts.customer.name, opts.property ?? null, opts.channel, bookingRef.id));
    return { taken: false as const, agenda, slot, lane, assignee };
  });

  if (result.taken) throw new SlotTakenError(await nearestSlots(uid, result.agenda, date, 5, opts.property?.id));
  return {
    id: bookingRef.id,
    agendaId,
    service: result.agenda.service,
    start: result.slot.start,
    label: formatSlot(result.slot.start, result.agenda.timezone),
    status: opts.status,
    lane: !result.assignee && result.agenda.lanes > 1 ? result.lane : null,
    assigneeId: result.assignee?.id ?? null,
    assigneeName: result.assignee?.name ?? null,
    property: opts.property ?? null,
  };
}

/** Follow-up for the agent who will attend a visit (deterministic id: one per booking). */
function visitTask(
  assigneeId: string,
  start: number,
  label: string,
  service: string,
  customerName: string,
  property: BookingProperty | null,
  channel: Partial<Channel>,
  bookingId: string,
) {
  return {
    title: `${service}: ${property?.title ?? "sin inmueble"} con ${customerName || "cliente"} · ${label}`,
    notes: "",
    dueAt: Timestamp.fromMillis(start),
    done: false,
    doneAt: null,
    assigneeId,
    clientId: null,
    dealId: null,
    propertyId: property?.id ?? null,
    conversationId: channel.conversationId ?? null,
    bookingId,
    kind: "booking",
    createdAt: FieldValue.serverTimestamp(),
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
    const assigneeId = (b.get("assigneeId") as string | null) ?? null;
    // The same agent in any staffed agenda, else the same sub-space; or the same property; at an overlapping time.
    const agenda = assigneeId ? parseAgenda(b.get("agendaId"), (await tx.get(db().doc(agendaDoc(uid, b.get("agendaId"))))).data()) : null;
    const others = agenda ? (await otherStaffedDays(uid, agenda, b.get("date"), tx)).flatMap((d) => d.busy) : [];
    const lane = (b.get("lane") as string | null) || "A";
    const propertyId = (b.get("property.id") as string | undefined) ?? null;
    const overlaps = (x: Busy & { id: string }) => x.id !== bookingId && isActive(x, now) && start < x.end && x.start < end;
    const clash =
      busyOf(day).some((x) => overlaps(x) && ((assigneeId ? x.assigneeId === assigneeId : laneOf(x) === lane) || (!!propertyId && x.propertyId === propertyId))) ||
      (!!assigneeId && others.some((x) => overlaps(x) && x.assigneeId === assigneeId));
    if (clash) throw new HttpsError("already-exists", "Ese horario ya fue reservado por otra persona");
    tx.set(
      dayRef,
      { busy: { [bookingId]: { start, end, status: "confirmed", holdExpiresAt: null, ...(assigneeId ? { assigneeId } : { lane }), propertyId } } },
      { merge: true },
    );
    tx.update(ref, { status: "confirmed", holdExpiresAt: null, confirmedAt: FieldValue.serverTimestamp() });
    if (assigneeId && b.get("channel.kind") !== "quote")
      tx.set(
        db().doc(taskDoc(uid, `booking_${bookingId}`)),
        visitTask(
          assigneeId,
          start,
          formatSlot(start, b.get("timezone") || "UTC"),
          b.get("service") ?? "Cita",
          b.get("customer.name") ?? "",
          (b.get("property") as BookingProperty | null) ?? null,
          (b.get("channel") as Channel | undefined) ?? {},
          bookingId,
        ),
      );
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
    const task = await tx.get(db().doc(taskDoc(uid, `booking_${bookingId}`)));
    tx.update(db().doc(agendaDayDoc(uid, b.get("agendaId"), b.get("date"))), { [`busy.${bookingId}`]: FieldValue.delete() });
    tx.update(ref, { status, cancelledAt: FieldValue.serverTimestamp() });
    if (task.exists && !task.get("done")) tx.update(task.ref, { done: true, doneAt: FieldValue.serverTimestamp(), notes: "Visita cancelada" });
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

export const kfGetSlots = onCall(async (req) => {
  const uid = await workspaceOf(req, "agenda");
  const { agendaId, date, propertyId } = req.data as { agendaId?: string; date?: string; propertyId?: string };
  if (!agendaId || !date || !DATE_RE.test(date)) throw new HttpsError("invalid-argument", "Faltan agendaId o date");
  const agenda = await getAgenda(uid, agendaId);
  if (!agenda) throw new HttpsError("not-found", "Agenda no encontrada");
  // With a property chosen, times when that property already has a visit are not offered.
  const [slots, agents] = await Promise.all([getSlots(uid, agenda, date, Date.now(), propertyId || null), agentsOf(uid, agenda)]);
  return {
    timezone: agenda.timezone,
    // Staffed agenda: `lanes` are agent ids; `agents` names them.
    agents: agents.map((a) => ({ id: a.id, name: a.name })),
    slots: slots.map((s) => ({ ...s, label: formatSlot(s.start, agenda.timezone) })),
  };
});

/**
 * Booking from the Agenda page / "Agendar" modal. The booking is linked to a client: the chosen one,
 * the one with that WhatsApp, or a new manual client (created only once the slot is secured).
 */
export const kfBookSlot = onCall(async (req) => {
  const uid = await workspaceOf(req, "agenda.book");
  const { agendaId, date, time, customer, notes, propertyId, lane, assigneeId } = req.data as {
    agendaId?: string;
    date?: string;
    time?: string;
    customer?: BookingClientInput;
    notes?: string;
    propertyId?: string;
    lane?: string;
    assigneeId?: string;
  };
  if (!agendaId || !date || !DATE_RE.test(date) || !time || !TIME_RE.test(time)) throw new HttpsError("invalid-argument", "Datos de reserva incompletos");
  if (!customer?.clientId && !customer?.firstName?.trim()) throw new HttpsError("invalid-argument", "Indica el nombre del cliente");
  let property: BookingProperty | null = null;
  if (propertyId) {
    const v = await bookingProperty(uid, propertyId);
    if ("error" in v) throw new HttpsError("invalid-argument", v.error);
    property = v;
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
      assigneeId: typeof assigneeId === "string" && assigneeId ? assigneeId.slice(0, 100) : undefined,
      property,
    });
    await saveBookingClient(uid, client, [booking.service, property?.title, booking.label].filter(Boolean).join(" · "));
    return { ...booking, client: { id: client.ref.id, name: client.name, created: client.created } };
  } catch (e) {
    if (e instanceof SlotTakenError) throw new HttpsError("already-exists", "Ese horario ya no está disponible");
    throw e;
  }
});

export const kfConfirmBooking = onCall(async (req) => {
  const uid = await workspaceOf(req, "agenda.book");
  const { bookingId } = req.data as { bookingId?: string };
  if (!bookingId) throw new HttpsError("invalid-argument", "Falta bookingId");
  await confirmBooking(uid, bookingId);
  return { ok: true };
});

export const kfCancelBooking = onCall(async (req) => {
  const uid = await workspaceOf(req, "agenda.book");
  const { bookingId } = req.data as { bookingId?: string };
  if (!bookingId) throw new HttpsError("invalid-argument", "Falta bookingId");
  await cancelBooking(uid, bookingId);
  return { ok: true };
});

/** Frees expired holds (drafts nobody sent). Availability already ignores them; this tidies the data. */
export const kfExpireHolds = onSchedule("every 60 minutes", async () => {
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

// ---------- public quote page (/c/{token}): visits without login ----------

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** Token → quote, rejecting unknown, expired or wrong-property requests. The token is the only credential. */
async function quoteForBooking(token: unknown, propertyId: unknown) {
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
  const properties = (q.get("properties") ?? []) as { id: string }[];
  if (typeof propertyId !== "string" || !properties.some((v) => v.id === propertyId)) throw new HttpsError("invalid-argument", "Ese inmueble no está en la cotización");
  const agendas = await listAgendas(uid);
  const agenda = agendas.find((a) => a.propertyRequired);
  if (!agenda) throw new HttpsError("failed-precondition", "No hay agenda de visitas");
  return { uid, quoteId, ref, q, agenda, propertyId };
}

export const kfQuoteSlots = onCall(async (req) => {
  const { token, propertyId, date } = (req.data ?? {}) as { token?: string; propertyId?: string; date?: string };
  if (!date || !DATE_RE.test(date)) throw new HttpsError("invalid-argument", "Fecha no válida");
  const { uid, agenda } = await quoteForBooking(token, propertyId);
  const slots = await getSlots(uid, agenda, date, Date.now(), propertyId);
  return { timezone: agenda.timezone, slots: slots.map((s) => ({ time: s.time, label: formatSlot(s.start, agenda.timezone) })) };
});

/** One active visit per quote; the booking is confirmed and the seller gets a follow-up. */
export const kfQuoteBook = onCall(async (req) => {
  const { token, propertyId, date, time, name, whatsapp } = (req.data ?? {}) as Record<string, string | undefined>;
  if (!date || !DATE_RE.test(date) || !time || !TIME_RE.test(time)) throw new HttpsError("invalid-argument", "Elige día y hora");
  if (!name?.trim()) throw new HttpsError("invalid-argument", "Indica tu nombre");
  const { uid, quoteId, ref, q, agenda } = await quoteForBooking(token, propertyId);
  // Empty = the WhatsApp saved with the quote (the page only shows its last digits).
  const phone = (whatsapp ?? "").trim() || ((q.get("clientWhatsapp") as string | undefined) ?? "");
  if (phone.replace(/\D/g, "").length < 8) throw new HttpsError("invalid-argument", "Indica tu WhatsApp");
  const prev = q.get("bookingId") as string | null;
  if (prev) {
    const b = await db().collection(bookingsCol(uid)).doc(prev).get();
    if (["held", "confirmed"].includes(b.get("status"))) throw new HttpsError("already-exists", "Ya tienes una visita agendada con esta cotización");
  }
  const property = await bookingProperty(uid, propertyId);
  if ("error" in property) throw new HttpsError("failed-precondition", property.error);
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
      property,
      preferAssigneeIds: [(q.get("sellerId") as string | null) ?? ""].filter(Boolean),
    });
    await saveBookingClient(uid, client, [booking.service, property.title, booking.label].filter(Boolean).join(" · "));
    await ref.update({ bookingId: booking.id });
    await db().doc(taskDoc(uid, `quote_booking_${quoteId}_${booking.id}`)).set({
      title: `${client.name} agendó ${booking.service.toLowerCase()} del ${property.title}: ${booking.label}`,
      dueAt: Timestamp.fromMillis(booking.start),
      assigneeId: booking.assigneeId ?? (q.get("sellerId") as string | null) ?? null,
      clientId: client.ref.id,
      dealId: (q.get("dealId") as string | null) ?? null,
      propertyId: property.id,
      conversationId: (q.get("conversationId") as string | null) ?? null,
      kind: "quote_booking",
      done: false,
      doneAt: null,
      notes: "",
      createdAt: FieldValue.serverTimestamp(),
    });
    return { label: booking.label, lane: booking.lane, agent: booking.assigneeName };
  } catch (e) {
    if (e instanceof SlotTakenError) throw new HttpsError("already-exists", "Ese horario se acaba de ocupar; elige otro");
    throw e;
  }
});
