"use client";

import { useState, type ReactElement } from "react";
import { addDays, format } from "date-fns";
import { toast } from "sonner";
import { BellPlus } from "lucide-react";
import { api } from "@/lib/api";
import type { Task } from "@/lib/types";
import { useCan } from "@/hooks/use-me";
import { usePutTask } from "@/hooks/use-tasks";
import { useDeals } from "@/hooks/use-deals";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Prefill = { title?: string; clientId?: string; dealId?: string; vehicleId?: string; conversationId?: string };
const local = (d: Date) => format(d, "yyyy-MM-dd'T'HH:mm");

/** Create or edit a follow-up (call, send a quote, confirm a visit…). */
export function TaskDialog({
  task,
  prefill,
  trigger,
  open: openProp,
  onOpenChange,
}: {
  task?: Task;
  prefill?: Prefill;
  trigger?: ReactElement;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
}) {
  const can = useCan();
  const putTask = usePutTask();
  const deals = useDeals();
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = onOpenChange ?? setOpenState;
  const initial = () => ({
    title: task?.title ?? prefill?.title ?? "",
    notes: task?.notes ?? "",
    dueAt: local(task ? new Date(task.dueAt) : addDays(new Date(new Date().setHours(10, 0, 0, 0)), 1)),
    assigneeId: task?.assigneeId ?? "",
  });
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const body = {
        title: form.title,
        notes: form.notes,
        dueAt: new Date(form.dueAt).toISOString(),
        ...(can("tasks.all") ? { assigneeId: form.assigneeId || null } : {}),
        ...(task ? {} : prefill),
      };
      const r = task
        ? await api<{ task: Task }>(`/api/tasks/${task.id}`, { method: "PATCH", body })
        : await api<{ task: Task }>("/api/tasks", { method: "POST", body });
      putTask(r.task);
      toast.success(task ? "Seguimiento guardado" : "Seguimiento agendado");
      setOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) setForm(initial());
        setOpen(o);
      }}
    >
      {trigger && <DialogTrigger render={trigger} />}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{task ? "Seguimiento" : "Nuevo seguimiento"}</DialogTitle>
          <DialogDescription>Aparece en Seguimientos y en el contador del menú el día que vence.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="t-title">Qué hay que hacer</Label>
            <Input id="t-title" placeholder="Llamar para enviar cotización" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="t-due">Cuándo</Label>
              <Input id="t-due" type="datetime-local" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} />
            </div>
            {can("tasks.all") && (
              <div className="space-y-1">
                <Label htmlFor="t-who">Responsable</Label>
                <select id="t-who" className="h-8 w-full rounded-lg border bg-background px-2 text-sm" value={form.assigneeId} onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}>
                  <option value="">Sin asignar</option>
                  {deals.data?.sellers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="t-notes">Notas</Label>
            <Textarea id="t-notes" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={saving || !form.title.trim()} onClick={save}>
            {saving ? "Guardando…" : task ? "Guardar" : "Agendar seguimiento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function NewTaskButton({ prefill }: { prefill: Prefill }) {
  const can = useCan();
  if (!can("tasks")) return null;
  return (
    <TaskDialog
      prefill={prefill}
      trigger={
        <Button variant="outline" size="sm">
          <BellPlus /> Seguimiento
        </Button>
      }
    />
  );
}
