"use client";

import { useState } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { CalendarClock, Pencil, Plus } from "lucide-react";
import { api } from "@/lib/api";
import type { Agenda } from "@/lib/types";
import { useAgendas } from "@/hooks/use-firestore";
import { AgendaEditor, DAYS } from "@/components/agenda/agenda-editor";
import { BookButton } from "@/components/agenda/booking-modal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const hours = (a: Agenda) =>
  DAYS.filter((d) => a.weekly[d.id]?.length)
    .map((d) => `${d.label.slice(0, 3)} ${a.weekly[d.id]!.map((r) => `${r.start}–${r.end}`).join(", ")}`)
    .join(" · ") || "Sin horario";

/** Ajustes → service agendas: create/edit them and book an appointment. */
export function AgendasCard() {
  const { data: agendas, loading } = useAgendas();
  const [editing, setEditing] = useState<Agenda | "new" | null>(null);

  async function toggleActive(a: Agenda) {
    try {
      await api(`/api/agendas/${a.id}`, { method: "PUT", body: { ...a, active: !a.active } });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <CalendarClock className="size-5" />
          <span className="mr-auto">Agendas de servicios</span>
          <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
            <Plus /> Nueva agenda
          </Button>
          <BookButton size="sm" />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">
          Cada agenda es un servicio con su duración y horario semanal. El agente IA ofrece y reserva estos horarios; también puedes agendar tú.
        </p>
        {loading && <p className="text-muted-foreground">Cargando…</p>}
        {!loading && !agendas.length && <p className="rounded-lg border border-dashed p-3 text-muted-foreground">Aún no hay agendas.</p>}
        <ul className="divide-y rounded-lg border">
          {agendas.map((a) => (
            <li key={a.id} className={cn("flex items-start gap-2 p-3", !a.active && "opacity-60")}>
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {a.service}
                  {!a.active && <span className="ml-2 text-xs font-normal text-muted-foreground">(inactiva)</span>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {a.durationMin} min{a.bufferMin ? ` + ${a.bufferMin} descanso` : ""}
                  {a.price && a.price !== "0" ? ` · ${a.price}` : ""} · {a.timezone}
                </p>
                <p className="truncate text-xs text-muted-foreground">{hours(a)}</p>
                <label className="mt-1 flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={a.active} onChange={() => toggleActive(a)} />
                  {a.active ? "Activa (el agente la ofrece)" : "Inactiva"}
                </label>
              </div>
              <Button variant="ghost" size="icon-sm" aria-label={`Editar ${a.service}`} onClick={() => setEditing(a)}>
                <Pencil />
              </Button>
            </li>
          ))}
        </ul>
        {agendas.length > 0 && (
          <Link href="/dashboard/agenda" className="inline-block text-xs text-primary hover:underline">
            Ver citas y horarios en la página Agenda →
          </Link>
        )}
      </CardContent>
      {editing && (
        <AgendaEditor
          key={editing === "new" ? "new" : editing.id}
          agenda={editing === "new" ? null : editing}
          open
          onOpenChange={(o) => !o && setEditing(null)}
        />
      )}
    </Card>
  );
}
