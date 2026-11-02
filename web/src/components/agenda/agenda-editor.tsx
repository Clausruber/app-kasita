"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Trash2, X } from "lucide-react";
import { api } from "@/lib/api";
import type { Agenda } from "@/lib/types";
import { DAYS, WeeklyHours } from "@/components/shared/weekly-hours";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export { DAYS };

type Draft = Omit<Agenda, "id">;

const blank = (): Draft => ({
  service: "",
  description: "",
  price: "",
  durationMin: 30,
  bufferMin: 0,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  weekly: Object.fromEntries(
    DAYS.map((d) => [d.id, ["sat", "sun"].includes(d.id) ? [] : [{ start: "09:00", end: "13:00" }, { start: "15:00", end: "19:00" }]]),
  ),
  blockedDates: [],
  minNoticeMin: 60,
  maxDaysAhead: 60,
  active: true,
});

/** Create / edit a service agenda: service, duration, weekly hours and blocked dates. */
export function AgendaEditor({ agenda, open, onOpenChange }: { agenda: Agenda | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [form, setForm] = useState<Draft>(() => (agenda ? { ...blank(), ...agenda } : blank()));
  const [blocked, setBlocked] = useState("");
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setSaving(true);
    try {
      if (agenda) await api(`/api/agendas/${agenda.id}`, { method: "PUT", body: form });
      else await api("/api/agendas", { method: "POST", body: form });
      toast.success(agenda ? "Agenda guardada" : "Agenda creada");
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!agenda || !confirm(`¿Eliminar la agenda "${agenda.service}"?`)) return;
    try {
      await api(`/api/agendas/${agenda.id}`, { method: "DELETE" });
      toast.success("Agenda eliminada");
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const num = (k: "durationMin" | "bufferMin" | "minNoticeMin" | "maxDaysAhead") => ({
    type: "number" as const,
    min: 0,
    value: String(form[k]),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{agenda ? "Editar agenda" : "Nueva agenda de servicio"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="ag-service">Servicio</Label>
            <Input id="ag-service" placeholder="Corte de pelo, consulta, clase…" value={form.service} onChange={(e) => set("service", e.target.value)} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="ag-desc">Descripción (la usa el agente)</Label>
            <Textarea id="ag-desc" rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ag-dur">Duración (min)</Label>
            <Input id="ag-dur" {...num("durationMin")} min={5} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ag-buf">Descanso entre citas (min)</Label>
            <Input id="ag-buf" {...num("bufferMin")} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ag-price">Precio (opcional)</Label>
            <Input id="ag-price" placeholder="25 €" value={form.price} onChange={(e) => set("price", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ag-tz">Zona horaria</Label>
            <Input id="ag-tz" value={form.timezone} onChange={(e) => set("timezone", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ag-notice">Antelación mínima (min)</Label>
            <Input id="ag-notice" {...num("minNoticeMin")} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ag-ahead">Reservar hasta (días)</Label>
            <Input id="ag-ahead" {...num("maxDaysAhead")} min={1} />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Horario semanal</Label>
          <WeeklyHours value={form.weekly} onChange={(w) => set("weekly", w)} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="ag-blocked">Fechas bloqueadas (festivos, vacaciones)</Label>
          <div className="flex gap-2">
            <Input id="ag-blocked" type="date" value={blocked} onChange={(e) => setBlocked(e.target.value)} />
            <Button
              variant="outline"
              disabled={!blocked}
              onClick={() => {
                set("blockedDates", [...new Set([...form.blockedDates, blocked])].sort());
                setBlocked("");
              }}
            >
              Añadir
            </Button>
          </div>
          <div className="flex flex-wrap gap-1">
            {form.blockedDates.map((d) => (
              <span key={d} className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
                {d}
                <button aria-label={`Quitar ${d}`} onClick={() => set("blockedDates", form.blockedDates.filter((x) => x !== d))}>
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        </div>

        <DialogFooter>
          {agenda && (
            <Button variant="ghost" className="mr-auto text-destructive" onClick={remove}>
              <Trash2 /> Eliminar
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={saving || !form.service.trim()} onClick={save}>
            {saving ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
