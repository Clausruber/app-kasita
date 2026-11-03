"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { Bot, CalendarClock, Pencil } from "lucide-react";
import { api } from "@/lib/api";
import type { Agenda } from "@/lib/types";
import { useAgendas, useBookings } from "@/hooks/use-firestore";
import { AgendaEditor, DAYS } from "@/components/agenda/agenda-editor";
import { AgendaDay, STATUS_LABEL } from "@/components/agenda/agenda-day";
import { BookButton } from "@/components/agenda/booking-modal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useCan } from "@/hooks/use-me";

const hoursSummary = (a: Agenda) =>
  DAYS.filter((d) => a.weekly[d.id]?.length)
    .map((d) => d.label.slice(0, 3))
    .join(" · ") || "Sin horario";

const whenLabel = (ms: number, tz: string) =>
  new Intl.DateTimeFormat("es-ES", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    new Date(ms),
  );

/**
 * Service agendas: weekly hours + duration generate the free slots that the AI agent offers in the
 * inbox. The admin can also book, confirm or cancel directly here.
 */
export default function AgendaPage() {
  const { data: agendas, loading, error } = useAgendas();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Agenda | null>(null);
  const can = useCan();
  const selected = agendas.find((a) => a.id === selectedId) ?? agendas[0] ?? null;

  const [from, to] = useMemo(() => {
    const now = new Date();
    return [new Date(now.getTime() - 3600_000), new Date(now.getTime() + 30 * 86400_000)];
  }, []);
  const { data: upcoming } = useBookings(from, to);
  const active = upcoming.filter((b) => b.status === "held" || b.status === "confirmed");

  async function toggleActive(a: Agenda) {
    try {
      await api(`/api/agendas/${a.id}`, { method: "PUT", body: { ...a, active: !a.active } });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-semibold">Agenda de servicios</h1>
        <BookButton />
      </div>
      <p className="text-sm text-muted-foreground">
        El agente IA consulta estos horarios cuando alguien pregunta por disponibilidad y reserva el que la persona confirma. En modo
        manual la cita queda pendiente hasta que envías la respuesta.
      </p>
      {error && <p className="text-sm text-destructive">{error.message}</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
        <div className="space-y-2">
          {loading && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {!loading && !agendas.length && (
            <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
              Aún no hay agendas.{" "}
              <Link href="/dashboard/settings#agendas" className="text-primary hover:underline">
                Créala en Ajustes
              </Link>{" "}
              con el servicio, su duración y tu horario semanal.
            </div>
          )}
          {agendas.map((a) => (
            <div
              key={a.id}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedId(a.id)}
              onKeyDown={(e) => e.key === "Enter" && setSelectedId(a.id)}
              className={cn(
                "cursor-pointer space-y-1 rounded-xl border p-3 text-sm transition-colors hover:bg-muted/50",
                selected?.id === a.id && "border-primary bg-primary/5",
                !a.active && "opacity-60",
              )}
            >
              <div className="flex items-center gap-2">
                <span className="mr-auto font-medium">{a.service}</span>
                {can("settings.agendas") && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Editar agenda"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(a);
                  }}
                >
                  <Pencil />
                </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {a.durationMin} min{a.bufferMin ? ` + ${a.bufferMin} descanso` : ""}
                {a.price ? ` · ${a.price}` : ""} · {hoursSummary(a)}
              </p>
              <label className="flex items-center gap-2 text-xs" onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" checked={a.active} disabled={!can("settings.agendas")} onChange={() => toggleActive(a)} />
                {a.active ? "Activa (el agente la ofrece)" : "Inactiva"}
              </label>
            </div>
          ))}
        </div>

        <div className="space-y-4">
          {selected && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CalendarClock className="size-5" /> {selected.service}
                  <span className="text-xs font-normal text-muted-foreground">{selected.timezone}</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <AgendaDay key={selected.id} agenda={selected} />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Próximas citas</CardTitle>
            </CardHeader>
            <CardContent>
              {!active.length ? (
                <p className="text-sm text-muted-foreground">No hay citas en los próximos 30 días.</p>
              ) : (
                <ul className="divide-y text-sm">
                  {active.map((b) => (
                    <li key={b.id} className="flex flex-wrap items-center gap-2 py-2">
                      <span className="w-40 capitalize">{whenLabel(b.start.toMillis(), b.timezone)}</span>
                      <span className="font-medium">{b.customer.name}</span>
                      <span className="text-muted-foreground">
                        · {b.service}
                        {b.lane ? ` ${b.lane}` : ""}
                        {b.vehicle ? ` · ${b.vehicle.title}` : ""}
                      </span>
                      {b.source === "ai" && <Bot className="size-4 text-violet-500" aria-label="Reservada por el agente" />}
                      <span className={cn("ml-auto text-xs", b.status === "held" && "text-amber-700 dark:text-amber-300")}>{STATUS_LABEL[b.status]}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {editing && (
        <AgendaEditor
          key={editing.id}
          agenda={editing}
          open
          onOpenChange={(o) => !o && setEditing(null)}
        />
      )}
    </div>
  );
}
