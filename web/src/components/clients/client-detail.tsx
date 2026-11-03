"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";
import { Bot, CalendarCheck, MessageCircle, Plus, X } from "lucide-react";
import { api } from "@/lib/api";
import { platformName } from "@/lib/platforms";
import type { Client, ClientBooking } from "@/lib/types";
import { Avatar } from "@/components/inbox/commenter-list";
import { BookButton } from "@/components/agenda/booking-modal";
import { NewDealButton } from "@/components/deals/deal-dialogs";
import { NewTaskButton } from "@/components/tasks/task-dialog";
import { QuoteHistory } from "@/components/quotes/quote-history";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useCan } from "@/hooks/use-me";

type Form = Pick<Client, "firstName" | "lastName" | "whatsapp" | "email" | "notes" | "extra">;
const formOf = (c: Client): Form => ({
  firstName: c.firstName,
  lastName: c.lastName,
  whatsapp: c.whatsapp,
  email: c.email,
  notes: c.notes,
  extra: c.extra.length ? c.extra : [],
});

const STATUS: Record<string, string> = { held: "Pendiente", confirmed: "Confirmada", cancelled: "Cancelada", expired: "Caducada" };
const when = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("es-ES", { timeZone: tz, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    new Date(iso),
  );

/** "IA" marker next to a field the agent filled from the conversation (until the owner edits it). */
function AiMark({ at }: { at?: string }) {
  if (!at) return null;
  return (
    <span
      className="ml-1 inline-flex items-center gap-0.5 rounded bg-violet-500/15 px-1 text-[10px] font-normal text-violet-700 dark:text-violet-300"
      title={`Guardado por el agente IA el ${format(new Date(at), "d MMM yyyy, HH:mm", { locale: es })}`}
    >
      <Bot className="size-3" /> IA
    </span>
  );
}

/** Client card: social data (read-only), editable data (name, WhatsApp, extra fields…) and bookings. */
export function ClientDetail({ client }: { client: Client }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(() => formOf(client));
  const [saving, setSaving] = useState(false);
  const canEdit = useCan()("clients.edit");
  const { data } = useQuery({
    queryKey: ["client", client.id],
    queryFn: () => api<{ client: Client; bookings: ClientBooking[] }>(`/api/clients/${encodeURIComponent(client.id)}`),
  });
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = JSON.stringify(form) !== JSON.stringify(formOf(client));
  const waDigits = client.whatsapp.replace(/\D/g, "");

  async function save() {
    setSaving(true);
    try {
      const r = await api<{ client: Client }>(`/api/clients/${encodeURIComponent(client.id)}`, { method: "PUT", body: form });
      qc.setQueryData<{ clients: Client[] }>(["clients"], (old) => old && { clients: old.clients.map((c) => (c.id === client.id ? r.client : c)) });
      setForm(formOf(r.client));
      toast.success("Cliente guardado");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Avatar name={client.displayName || "?"} picture={client.picture} className="size-14 text-lg" />
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold">
            {[client.firstName, client.lastName].filter(Boolean).join(" ") || client.displayName || "Sin nombre"}
          </p>
          <p className="truncate text-sm text-muted-foreground">
            {platformName(client.platform)} · {client.displayName}
            {client.username ? ` (@${client.username})` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            {client.messageCount} mensaje{client.messageCount === 1 ? "" : "s"}
            {client.firstContactAt && ` · primer contacto ${format(new Date(client.firstContactAt), "d MMM yyyy", { locale: es })}`}
            {client.lastContactAt && ` · último ${format(new Date(client.lastContactAt), "d MMM yyyy, HH:mm", { locale: es })}`}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <NewDealButton prefill={{ clientId: client.id }} />
        <NewTaskButton prefill={{ clientId: client.id, title: `Dar seguimiento a ${[client.firstName, client.lastName].filter(Boolean).join(" ") || client.displayName}` }} />
      </div>

      {client.lastMessage && (
        <p className="flex gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
          <MessageCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span className="line-clamp-3">{client.lastMessage}</span>
        </p>
      )}

      <fieldset disabled={!canEdit} className="grid gap-3 disabled:opacity-80 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="cl-first">
            Nombre <AiMark at={client.aiEdited.firstName} />
          </Label>
          <Input id="cl-first" value={form.firstName} onChange={(e) => set("firstName", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cl-last">
            Apellidos <AiMark at={client.aiEdited.lastName} />
          </Label>
          <Input id="cl-last" value={form.lastName} onChange={(e) => set("lastName", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cl-wa">
            WhatsApp <AiMark at={client.aiEdited.whatsapp} />
          </Label>
          <div className="flex gap-2">
            <Input id="cl-wa" type="tel" placeholder="+5511987654321" value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} />
            {waDigits && (
              <a
                className="inline-flex h-8 shrink-0 items-center rounded-lg border px-2.5 text-sm hover:bg-muted"
                href={`https://wa.me/${waDigits}`}
                target="_blank"
                rel="noreferrer"
              >
                Abrir
              </a>
            )}
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="cl-email">
            Email <AiMark at={client.aiEdited.email} />
          </Label>
          <Input id="cl-email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="cl-notes">Notas</Label>
          <Textarea id="cl-notes" rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </div>
      </fieldset>

      <fieldset disabled={!canEdit} className="space-y-2">
        <Label>Otros datos</Label>
        {form.extra.map((x, i) => (
          <div key={i} className="flex gap-2">
            <Input
              className="w-40 shrink-0"
              placeholder="Dato (p. ej. Cumpleaños)"
              value={x.label}
              onChange={(e) => set("extra", form.extra.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))}
            />
            <Input
              placeholder="Valor"
              value={x.value}
              onChange={(e) => set("extra", form.extra.map((y, j) => (j === i ? { ...y, value: e.target.value } : y)))}
            />
            <Button variant="ghost" size="icon-sm" aria-label="Quitar dato" onClick={() => set("extra", form.extra.filter((_, j) => j !== i))}>
              <X />
            </Button>
          </div>
        ))}
        <Button variant="outline" size="sm" disabled={form.extra.length >= 20} onClick={() => set("extra", [...form.extra, { label: "", value: "" }])}>
          <Plus /> Añadir dato
        </Button>
      </fieldset>

      {canEdit && (
      <div className="flex gap-2">
        <Button disabled={!dirty || saving} onClick={save}>
          {saving ? "Guardando…" : "Guardar"}
        </Button>
        {dirty && (
          <Button variant="ghost" onClick={() => setForm(formOf(client))}>
            Descartar cambios
          </Button>
        )}
      </div>
      )}

      <QuoteHistory clientId={client.id} clientName={[client.firstName, client.lastName].filter(Boolean).join(" ") || client.displayName} clientWhatsapp={client.whatsapp} />

      <div className="space-y-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <CalendarCheck className="size-4" /> <span className="mr-auto">Citas</span>
          <BookButton
            size="sm"
            variant="outline"
            prefill={{ client: { id: client.id, firstName: client.firstName, lastName: client.lastName, whatsapp: client.whatsapp } }}
          />
        </h3>
        {!data ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : !data.bookings.length ? (
          <p className="text-sm text-muted-foreground">Sin citas.</p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {data.bookings.map((b) => (
              <li key={b.id} className="flex items-center gap-2 px-3 py-2">
                <span className="capitalize">{when(b.start, b.timezone)}</span>
                <span className="text-muted-foreground">· {b.service}</span>
                <span className={cn("ml-auto text-xs", ["cancelled", "expired"].includes(b.status) && "text-muted-foreground line-through")}>
                  {STATUS[b.status] ?? b.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
