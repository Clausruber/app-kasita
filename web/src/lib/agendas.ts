import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import { HttpError } from "@/lib/auth-guard";
import { adminDb } from "@/lib/firebase/admin";
import { agendaDoc, userDoc } from "@/lib/firebase/paths";

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const toMin = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3);
const clip = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const int = (v: unknown, min: number, max: number, name: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${name} debe estar entre ${min} y ${max}`);
  return n;
};

/** Validates and normalises an agenda sent by the Agenda page (slot logic lives in functions/src/agenda.ts). */
export function parseAgendaInput(body: Record<string, unknown>) {
  const service = clip(body.service, 120);
  if (!service) throw new HttpError(400, "Indica el nombre del servicio");
  const timezone = clip(body.timezone, 64) || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new HttpError(400, "Zona horaria no válida");
  }
  const weeklyIn = (body.weekly ?? {}) as Record<string, { start?: string; end?: string }[]>;
  const weekly: Record<string, { start: string; end: string }[]> = {};
  for (const d of WEEKDAYS) {
    const ranges = (Array.isArray(weeklyIn[d]) ? weeklyIn[d] : []).slice(0, 8).map((r) => {
      if (!TIME.test(r.start ?? "") || !TIME.test(r.end ?? "") || toMin(r.end!) <= toMin(r.start!))
        throw new HttpError(400, `Franja no válida (${d}): ${r.start}–${r.end}`);
      return { start: r.start!, end: r.end! };
    });
    ranges.sort((a, b) => toMin(a.start) - toMin(b.start));
    if (ranges.some((r, i) => i > 0 && toMin(r.start) < toMin(ranges[i - 1].end))) throw new HttpError(400, `Franjas solapadas (${d})`);
    weekly[d] = ranges;
  }
  const blockedDates = [...new Set((Array.isArray(body.blockedDates) ? body.blockedDates : []).filter((x): x is string => typeof x === "string" && DATE.test(x)))]
    .sort()
    .slice(0, 366);
  return {
    service,
    name: service,
    description: clip(body.description, 1000),
    price: clip(body.price, 60),
    durationMin: int(body.durationMin, 5, 720, "La duración"),
    bufferMin: int(body.bufferMin ?? 0, 0, 240, "El descanso"),
    timezone,
    weekly,
    blockedDates,
    minNoticeMin: int(body.minNoticeMin ?? 0, 0, 30 * 24 * 60, "La antelación mínima"),
    maxDaysAhead: int(body.maxDaysAhead ?? 60, 1, 365, "Los días de antelación"),
    active: body.active !== false,
    lanes: int(body.lanes ?? 1, 1, MAX_LANES, "Los espacios por horario"),
    vehicleRequired: Boolean(body.vehicleRequired),
  };
}

export const MAX_LANES = 6; // A–F, same as functions/src/agenda.ts
export const TEST_DRIVE_AGENDA_ID = "prueba-de-manejo";

/**
 * Every account starts with a "Prueba de manejo" agenda the admin then adjusts. Created once: the
 * flag on the workspace doc keeps it from coming back if the admin deletes it.
 */
export async function ensureTestDriveAgenda(uid: string) {
  const userRef = adminDb.doc(userDoc(uid));
  const agendaRef = adminDb.doc(agendaDoc(uid, TEST_DRIVE_AGENDA_ID));
  await adminDb.runTransaction(async (tx) => {
    const [user, agenda] = await Promise.all([tx.get(userRef), tx.get(agendaRef)]);
    if (user.get("seeded.testDriveAgenda")) return;
    if (!agenda.exists) {
      const range = (start: string, end: string) => [{ start, end }];
      tx.set(agendaRef, {
        service: "Prueba de manejo",
        name: "Prueba de manejo",
        kind: "test_drive",
        description: "Prueba de manejo de un auto del inventario. Trae tu licencia de conducir vigente e identificación oficial.",
        price: "",
        durationMin: 45,
        bufferMin: 15,
        timezone: (user.get("company.timezone") as string | undefined) || "America/Mexico_City",
        weekly: {
          mon: range("10:00", "18:00"),
          tue: range("10:00", "18:00"),
          wed: range("10:00", "18:00"),
          thu: range("10:00", "18:00"),
          fri: range("10:00", "18:00"),
          sat: range("10:00", "14:00"),
          sun: [],
        },
        blockedDates: [],
        minNoticeMin: 120,
        maxDaysAhead: 30,
        active: true,
        lanes: 2,
        vehicleRequired: true,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    tx.set(userRef, { seeded: { testDriveAgenda: true } }, { merge: true });
  });
}
