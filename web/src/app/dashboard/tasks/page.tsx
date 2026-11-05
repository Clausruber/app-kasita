"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { format, isToday, isTomorrow } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";
import { Bell, Building2, Clock, KanbanSquare, MessageCircle, Plus, Trash2, UserRound } from "lucide-react";
import { api } from "@/lib/api";
import type { Task } from "@/lib/types";
import { useCan } from "@/hooks/use-me";
import { useDeals } from "@/hooks/use-deals";
import { endOfToday, usePutTask, useTasks, type TasksData } from "@/hooks/use-tasks";
import { useQueryClient } from "@tanstack/react-query";
import { TaskDialog } from "@/components/tasks/task-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<Task["kind"], string | null> = {
  manual: null,
  stale_lead: "Lead sin respuesta",
  reservation_expiry: "Apartado por vencer",
  quote_viewed: "Cotización vista",
  quote_accepted: "Cotización aceptada",
  quote_booking: "Visita agendada",
  hold_expiry: "Bloqueo por vencer",
  lease_end: "Fin de contrato de renta",
  booking: "Visita asignada",
};

const when = (iso: string) => {
  const d = new Date(iso);
  const day = isToday(d) ? "Hoy" : isTomorrow(d) ? "Mañana" : format(d, "EEE d MMM", { locale: es });
  return `${day}, ${format(d, "HH:mm")}`;
};

function TaskRow({ task, now, seller, onEdit, onToggle, onDelete }: { task: Task; now: number; seller?: string; onEdit: () => void; onToggle: () => void; onDelete: () => void }) {
  const overdue = !task.done && new Date(task.dueAt).getTime() < now;
  const kind = KIND_LABEL[task.kind];
  return (
    <li className="flex items-start gap-3 rounded-lg border p-3">
      <Checkbox className="mt-0.5" checked={task.done} onCheckedChange={onToggle} aria-label="Marcar como hecho" />
      <div className="min-w-0 flex-1">
        <button type="button" onClick={onEdit} className={cn("block text-left text-sm font-medium", task.done && "text-muted-foreground line-through")}>
          {task.title}
        </button>
        {task.notes && <p className="line-clamp-2 text-xs text-muted-foreground">{task.notes}</p>}
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className={cn("flex items-center gap-1", overdue && "font-medium text-destructive")}>
            <Clock className="size-3" /> {when(task.dueAt)}
          </span>
          {kind && (
            <span className="flex items-center gap-1 text-violet-700 dark:text-violet-300">
              <Bell className="size-3" /> {kind}
            </span>
          )}
          {seller && <span>{seller}</span>}
          {task.clientId && (
            <Link href="/dashboard/clients" className="flex items-center gap-1 hover:text-foreground">
              <UserRound className="size-3" /> Cliente
            </Link>
          )}
          {task.dealId && (
            <Link href="/dashboard/pipeline" className="flex items-center gap-1 hover:text-foreground">
              <KanbanSquare className="size-3" /> Oportunidad
            </Link>
          )}
          {task.propertyId && (
            <Link href={`/dashboard/inventory/${task.propertyId}`} className="flex items-center gap-1 hover:text-foreground">
              <Building2 className="size-3" /> Propiedad
            </Link>
          )}
          {task.conversationId && (
            <Link href="/dashboard/inbox" className="flex items-center gap-1 hover:text-foreground">
              <MessageCircle className="size-3" /> Conversación
            </Link>
          )}
        </p>
      </div>
      <Button variant="ghost" size="icon-xs" aria-label={task.kind === "manual" ? "Borrar" : "Descartar"} onClick={onDelete}>
        <Trash2 />
      </Button>
    </li>
  );
}

/** Seguimientos: overdue, today and upcoming follow-ups, manual or created by the scheduler. */
export default function TasksPage() {
  const { data, isLoading, error, dataUpdatedAt } = useTasks();
  const deals = useDeals();
  const can = useCan();
  const qc = useQueryClient();
  const putTask = usePutTask();
  const [editing, setEditing] = useState<Task | null>(null);
  const [creating, setCreating] = useState(false);
  const [who, setWho] = useState<"mine" | "all">("mine");
  // Grouping reference time: when the list was last fetched (refetched on every task change).
  const now = dataUpdatedAt;
  const sellers = useMemo(() => new Map((deals.data?.sellers ?? []).map((s) => [s.id, s.name])), [deals.data]);

  const groups = useMemo(() => {
    const today = endOfToday().getTime();
    const tasks = (data?.tasks ?? []).filter((t) => who === "all" || !t.assigneeId || t.assigneeId === data?.me);
    const pending = tasks.filter((t) => !t.done);
    return [
      { id: "overdue", title: "Vencidas", items: pending.filter((t) => new Date(t.dueAt).getTime() < now) },
      { id: "today", title: "Hoy", items: pending.filter((t) => { const d = new Date(t.dueAt).getTime(); return d >= now && d <= today; }) },
      { id: "next", title: "Próximas", items: pending.filter((t) => new Date(t.dueAt).getTime() > today) },
      { id: "done", title: "Hechas (últimos 14 días)", items: tasks.filter((t) => t.done).reverse() },
    ];
  }, [data, who, now]);

  async function toggle(t: Task) {
    putTask({ ...t, done: !t.done }); // optimistic
    try {
      const r = await api<{ task: Task }>(`/api/tasks/${t.id}`, { method: "PATCH", body: { done: !t.done } });
      putTask(r.task);
    } catch (e) {
      putTask(t);
      toast.error((e as Error).message);
    }
  }

  async function remove(t: Task) {
    if (t.kind === "manual" && !confirm("¿Borrar este seguimiento?")) return;
    try {
      await api(`/api/tasks/${t.id}`, { method: "DELETE" });
      if (t.kind === "manual") qc.setQueryData<TasksData>(["tasks"], (old) => old && { ...old, tasks: old.tasks.filter((x) => x.id !== t.id) });
      else putTask({ ...t, done: true });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-semibold">Seguimientos</h1>
        {can("tasks.all") && (
          <select className="h-8 rounded-lg border bg-background px-2 text-sm" value={who} onChange={(e) => setWho(e.target.value as "mine" | "all")} aria-label="De quién">
            <option value="mine">Míos</option>
            <option value="all">Todo el equipo</option>
          </select>
        )}
        <Button onClick={() => setCreating(true)}>
          <Plus /> Nuevo seguimiento
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : (
        groups.map((g) =>
          g.items.length || g.id === "today" ? (
            <section key={g.id} className="space-y-2">
              <h2 className={cn("text-sm font-semibold", g.id === "overdue" && "text-destructive")}>
                {g.title} <span className="font-normal text-muted-foreground">· {g.items.length}</span>
              </h2>
              {g.items.length ? (
                <ul className="space-y-2">
                  {g.items.map((t) => (
                    <TaskRow
                      key={t.id}
                      task={t}
                      now={now}
                      seller={who === "all" && t.assigneeId ? sellers.get(t.assigneeId) : undefined}
                      onEdit={() => setEditing(t)}
                      onToggle={() => toggle(t)}
                      onDelete={() => remove(t)}
                    />
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Nada pendiente para hoy.</p>
              )}
            </section>
          ) : null,
        )
      )}
      <TaskDialog open={creating} onOpenChange={setCreating} />
      {editing && <TaskDialog task={editing} open onOpenChange={(o) => !o && setEditing(null)} />}
    </div>
  );
}
