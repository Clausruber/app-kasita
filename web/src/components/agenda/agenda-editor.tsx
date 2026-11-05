"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Trash2, X } from "lucide-react";
import { api } from "@/lib/api";
import type { Agenda } from "@/lib/types";
import { useAgents } from "@/hooks/use-agents";
import { DAYS, WeeklyHours } from "@/components/shared/weekly-hours";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DateField, ddmmyyyy } from "@/components/shared/date-field";

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
  lanes: 1,
  propertyRequired: false,
  agents: null,
});

const LANE_OPTIONS = [1, 2, 3, 4, 5, 6].map((n) => ({
  value: n,
  label: n === 1 ? "1 (una cita por horario)" : `${n} (${"ABCDEF".slice(0, n).split("").join(", ")})`,
}));

/** Create / edit a service agenda: service, duration, weekly hours and blocked dates. */
export function AgendaEditor({ agenda, open, onOpenChange }: { agenda: Agenda | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [form, setForm] = useState<Draft>(() => (agenda ? { ...blank(), ...agenda } : blank()));
  const [blocked, setBlocked] = useState("");
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setForm((f) => ({ ...f, [k]: v }));
  const agents = useAgents(open).data?.agents ?? [];
  const staffing = form.agents === "all" ? "all" : Array.isArray(form.agents) ? "some" : "none";

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
          <div className="space-y-1">
            <Label htmlFor="ag-staff">Atendida por</Label>
            <select
              id="ag-staff"
              className="h-8 w-full rounded-lg border bg-background px-2 text-sm"
              value={staffing}
              onChange={(e) => set("agents", e.target.value === "all" ? "all" : e.target.value === "some" ? agents.map((a) => a.id) : null)}
            >
              <option value="all">Asesores del equipo (todos)</option>
              <option value="some">Asesores seleccionados</option>
              <option value="none">Sin asesores (espacios anónimos)</option>
            </select>
            <p className="text-xs text-muted-foreground">
              {staffing === "none"
                ? "Cada horario admite varias citas sin asignarlas a nadie."
                : "Cada cita se asigna a un asesor libre según su horario (Ajustes → Perfil → Mi horario de visitas)."}
            </p>
          </div>
          {staffing === "none" && (
            <div className="space-y-1">
              <Label htmlFor="ag-lanes">Citas al mismo tiempo</Label>
              <select
                id="ag-lanes"
                className="h-8 w-full rounded-lg border bg-background px-2 text-sm"
                value={form.lanes ?? 1}
                onChange={(e) => set("lanes", Number(e.target.value))}
              >
                {LANE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          {staffing === "some" && (
            <div className="space-y-1 sm:col-span-2">
              <Label>Asesores que atienden esta agenda</Label>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {agents.map((a) => {
                  const list = Array.isArray(form.agents) ? form.agents : [];
                  return (
                    <label key={a.id} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={list.includes(a.id)} onCheckedChange={(c) => set("agents", c ? [...list, a.id] : list.filter((x) => x !== a.id))} />
                      {a.name}
                    </label>
                  );
                })}
              </div>
            </div>
          )}
          <label className="flex items-start gap-2 self-center text-sm">
            <Checkbox className="mt-0.5" checked={!!form.propertyRequired} onCheckedChange={(c) => set("propertyRequired", c === true)} />
            <span>
              Pedir la propiedad (visita)
              <span className="block text-xs text-muted-foreground">Cada cita indica qué propiedad se visita; una propiedad no se agenda dos veces a la misma hora.</span>
            </span>
          </label>
        </div>

        <div className="space-y-2">
          <Label>Horario semanal</Label>
          <WeeklyHours value={form.weekly} onChange={(w) => set("weekly", w)} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="ag-blocked">Fechas bloqueadas (festivos, vacaciones)</Label>
          <div className="flex gap-2">
            <DateField id="ag-blocked" className="flex-1" value={blocked} onChange={setBlocked} />
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
                {ddmmyyyy(d)}
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
