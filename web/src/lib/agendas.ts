import "server-only";

import { HttpError } from "@/lib/auth-guard";

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
  };
}
