"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Bot, CalendarClock } from "lucide-react";
import { useAgendas, useBookings } from "@/hooks/use-firestore";
import { AgendaDay, STATUS_LABEL } from "@/components/agenda/agenda-day";
import { BookButton } from "@/components/agenda/booking-modal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useMe } from "@/hooks/use-me";
import { useAgents } from "@/hooks/use-agents";

const whenLabel = (ms: number, tz: string) =>
  new Intl.DateTimeFormat("es-ES", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(ms));

/**
 * Service agendas: weekly hours + duration generate the free slots that the AI agent offers in the
 * inbox. The admin can also book, confirm or cancel directly here. Agendas are set up in Ajustes → Perfil.
 */
export default function AgendaPage() {
  const { data: agendas, loading, error } = useAgendas();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = agendas.find((a) => a.id === selectedId) ?? agendas[0] ?? null;

  const [from, to] = useMemo(() => {
    const now = new Date();
    return [new Date(now.getTime() - 3600_000), new Date(now.getTime() + 30 * 86400_000)];
  }, []);
  const { data: upcoming } = useBookings(from, to);
  // "Mis visitas" / one agent: only for agendas with agents (bookings carry who attends).
  const me = useMe().data?.sellerId ?? null;
  const staffed = agendas.some((a) => a.agents);
  const agents = useAgents(staffed).data?.agents ?? [];
  const [who, setWho] = useState("all");
  const agentId = who === "all" ? null : who === "me" ? me : who;
  const active = upcoming.filter((b) => (b.status === "held" || b.status === "confirmed") && (!agentId || b.assigneeId === agentId));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-semibold">Agenda de servicios</h1>
        {staffed && (
          <select
            className="h-8 rounded-lg border bg-background px-2 text-sm"
            value={who}
            onChange={(e) => setWho(e.target.value)}
            aria-label="Filtrar por asesor"
          >
            <option value="all">Todos los asesores</option>
            {me && <option value="me">Mis visitas</option>}
            {agents
              .filter((a) => a.id !== me)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        )}
        <BookButton />
      </div>
      <p className="text-sm text-muted-foreground">
        El agente IA consulta estos horarios cuando alguien pregunta por disponibilidad y reserva el que la persona confirma. En modo manual la cita queda
        pendiente hasta que envías la respuesta.
      </p>
      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {loading && <p className="text-sm text-muted-foreground">Cargando…</p>}
      {!loading && !agendas.length && (
        <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          Aún no hay agendas.{" "}
          <Link href="/dashboard/settings#agendas" className="text-primary hover:underline">
            Créala en Ajustes → Perfil
          </Link>{" "}
          con el servicio, su duración y tu horario semanal.
        </div>
      )}

      {/* Day view 60 % · upcoming visits 40 % (stacked on smaller screens). */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {selected && (
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                <CalendarClock className="size-5" />
                {agendas.length > 1 ? (
                  <select
                    className="h-8 rounded-lg border bg-background px-2 text-base font-semibold"
                    value={selected.id}
                    onChange={(e) => setSelectedId(e.target.value)}
                    aria-label="Agenda"
                  >
                    {agendas.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.service}
                        {a.active ? "" : " (inactiva)"}
                      </option>
                    ))}
                  </select>
                ) : (
                  selected.service
                )}
                <span className="text-xs font-normal text-muted-foreground">{selected.timezone}</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <AgendaDay key={selected.id} agenda={selected} agentId={agentId} />
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
                  <li key={b.id} className="space-y-0.5 py-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium capitalize">{whenLabel(b.start.toMillis(), b.timezone)}</span>
                      {b.source === "ai" && <Bot className="size-4 text-violet-500" aria-label="Reservada por el agente" />}
                      <span className={cn("ml-auto text-xs", b.status === "held" && "text-amber-700 dark:text-amber-300")}>{STATUS_LABEL[b.status]}</span>
                    </div>
                    <p className="truncate">{b.customer.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {b.service}
                      {b.lane ? ` ${b.lane}` : ""}
                      {b.property ? ` · ${b.property.title}` : ""}
                    </p>
                    {b.assigneeName && <p className="truncate text-xs text-muted-foreground">Atiende {b.assigneeName}</p>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
