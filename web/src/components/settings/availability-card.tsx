"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarClock, X } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Availability } from "@/lib/types";
import { WeeklyHours, type Weekly } from "@/components/shared/weekly-hours";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { DateField, ddmmyyyy } from "@/components/shared/date-field";

const DEFAULT_WEEKLY: Weekly = {
  mon: [{ start: "09:00", end: "18:00" }],
  tue: [{ start: "09:00", end: "18:00" }],
  wed: [{ start: "09:00", end: "18:00" }],
  thu: [{ start: "09:00", end: "18:00" }],
  fri: [{ start: "09:00", end: "18:00" }],
  sat: [],
  sun: [],
};
const EMPTY: Availability = { weekly: null, blockedDates: [] };
const dateLabel = (d: string) => `${new Date(`${d}T12:00:00`).toLocaleDateString("es-MX", { weekday: "short" })} ${ddmmyyyy(d)}`;

/**
 * An agent's visit hours: own weekly hours (or "follow each agenda's hours") and days off. Used for the
 * signed-in user (Ajustes → Perfil) and, by an admin, for any member (Equipo → miembro → Horario).
 */
export function AvailabilityEditor({ value, saving, onSave }: { value: Availability; saving: boolean; onSave: (v: Availability) => void }) {
  const [draft, setDraft] = useState<Availability>(value);
  const [day, setDay] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(value);
  const own = draft.weekly !== null;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <label className="flex items-start gap-2 text-sm">
        <Checkbox className="mt-0.5" checked={!own} onCheckedChange={(c) => setDraft({ ...draft, weekly: c === true ? null : DEFAULT_WEEKLY })} />
        <span>
          Usar el horario de cada agenda
          <span className="block text-xs text-muted-foreground">Desmárcalo para indicar en qué horario puedes atender visitas.</span>
        </span>
      </label>
      {own && <WeeklyHours value={draft.weekly ?? {}} onChange={(weekly) => setDraft({ ...draft, weekly })} />}

      <div className="space-y-2">
        <Label htmlFor="av-off">Días libres (vacaciones, ausencias)</Label>
        <div className="flex gap-2">
          <DateField id="av-off" className="flex-1" min={today} value={day} onChange={setDay} />
          <Button
            variant="outline"
            disabled={!day}
            onClick={() => {
              setDraft({ ...draft, blockedDates: [...new Set([...draft.blockedDates, day])].sort() });
              setDay("");
            }}
          >
            Añadir
          </Button>
        </div>
        <div className="flex flex-wrap gap-1">
          {draft.blockedDates.map((d) => (
            <span key={d} className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
              {dateLabel(d)}
              <button aria-label={`Quitar ${d}`} onClick={() => setDraft({ ...draft, blockedDates: draft.blockedDates.filter((x) => x !== d) })}>
                <X className="size-3" />
              </button>
            </span>
          ))}
          {!draft.blockedDates.length && <p className="text-xs text-muted-foreground">Sin días libres.</p>}
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t pt-3">
        {dirty && (
          <Button variant="ghost" onClick={() => setDraft(value)}>
            Descartar
          </Button>
        )}
        <Button disabled={!dirty || saving} onClick={() => onSave(draft)}>
          {saving ? "Guardando…" : "Guardar horario"}
        </Button>
      </div>
    </div>
  );
}

/** Ajustes → Perfil → "Mi horario de visitas". */
export function AvailabilityCard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = ["availability", user?.uid];
  const { data } = useQuery({ queryKey: key, enabled: !!user, queryFn: () => api<{ availability: Availability }>("/api/settings/availability") });
  const [saving, setSaving] = useState(false);

  async function save(v: Availability) {
    setSaving(true);
    try {
      qc.setQueryData(key, await api<{ availability: Availability }>("/api/settings/availability", { method: "PUT", body: v }));
      toast.success("Horario guardado");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="size-5" /> Mi horario de visitas
        </CardTitle>
        <CardDescription>Las visitas solo se te asignan dentro de este horario y nunca en tus días libres.</CardDescription>
      </CardHeader>
      <CardContent>
        {data ? <AvailabilityEditor key={JSON.stringify(data.availability)} value={data.availability ?? EMPTY} saving={saving} onSave={save} /> : null}
      </CardContent>
    </Card>
  );
}
