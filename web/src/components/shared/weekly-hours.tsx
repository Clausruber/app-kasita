"use client";

import { Plus, X } from "lucide-react";
import type { TimeRange, Weekday } from "@/lib/types";
import { Button } from "@/components/ui/button";

export const DAYS: { id: Weekday; label: string }[] = [
  { id: "mon", label: "Lunes" },
  { id: "tue", label: "Martes" },
  { id: "wed", label: "Miércoles" },
  { id: "thu", label: "Jueves" },
  { id: "fri", label: "Viernes" },
  { id: "sat", label: "Sábado" },
  { id: "sun", label: "Domingo" },
];

export type Weekly = Partial<Record<Weekday, TimeRange[]>>;

/** Weekly opening hours: several time ranges per day, empty = closed. Used by agendas and the company. */
export function WeeklyHours({ value, onChange }: { value: Weekly; onChange: (v: Weekly) => void }) {
  const setRanges = (d: Weekday, ranges: TimeRange[]) => onChange({ ...value, [d]: ranges });
  return (
    <div className="space-y-2">
      {DAYS.map((d) => {
        const ranges = value[d.id] ?? [];
        return (
          <div key={d.id} className="flex flex-wrap items-center gap-2 border-b pb-2 last:border-0">
            <span className="w-24 text-sm">{d.label}</span>
            {!ranges.length && <span className="text-xs text-muted-foreground">Cerrado</span>}
            {ranges.map((r, i) => (
              <span key={i} className="flex items-center gap-1 rounded-lg border px-1">
                <input
                  type="time"
                  aria-label={`${d.label}: desde`}
                  className="bg-transparent text-sm"
                  value={r.start}
                  onChange={(e) => setRanges(d.id, ranges.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))}
                />
                –
                <input
                  type="time"
                  aria-label={`${d.label}: hasta`}
                  className="bg-transparent text-sm"
                  value={r.end}
                  onChange={(e) => setRanges(d.id, ranges.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))}
                />
                <Button variant="ghost" size="icon-xs" aria-label="Quitar franja" onClick={() => setRanges(d.id, ranges.filter((_, j) => j !== i))}>
                  <X />
                </Button>
              </span>
            ))}
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Añadir franja el ${d.label}`}
              onClick={() => setRanges(d.id, [...ranges, { start: ranges.at(-1)?.end ?? "09:00", end: "20:00" }])}
            >
              <Plus />
            </Button>
          </div>
        );
      })}
    </div>
  );
}
