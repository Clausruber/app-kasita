"use client";

import { useEffect, useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { toast } from "sonner";
import { Bot, Check, ChevronLeft, ChevronRight, Clock, UserRound, X } from "lucide-react";
import { functions } from "@/lib/firebase/client";
import type { Agenda, Booking } from "@/lib/types";
import { useBookings } from "@/hooks/use-firestore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BookingModal } from "@/components/agenda/booking-modal";
import { cn } from "@/lib/utils";
import { useCan } from "@/hooks/use-me";

type Slot = { start: number; time: string; label: string; lanes: string[] };
const getSlotsFn = httpsCallable<{ agendaId: string; date: string }, { slots: Slot[] }>(functions, "alGetSlots");
export const confirmBookingFn = httpsCallable<{ bookingId: string }>(functions, "alConfirmBooking");
export const cancelBookingFn = httpsCallable<{ bookingId: string }>(functions, "alCancelBooking");

/** Today (YYYY-MM-DD) in a timezone. */
export const todayIn = (tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
const shift = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dayTitle = (date: string) =>
  new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

export const STATUS_LABEL: Record<Booking["status"], string> = {
  held: "Pendiente de confirmar",
  confirmed: "Confirmada",
  cancelled: "Cancelada",
  expired: "Caducada",
};

/** One agenda's day: free slots (click to book) and the bookings, both live. */
export function AgendaDay({ agenda }: { agenda: Agenda }) {
  const [date, setDate] = useState(() => todayIn(agenda.timezone));
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [booking, setBooking] = useState<Slot | null>(null);
  const canBook = useCan()("agenda.book");

  const range = useMemo(() => [new Date(`${shift(date, -1)}T00:00:00Z`), new Date(`${shift(date, 2)}T00:00:00Z`)] as const, [date]);
  const { data: bookings } = useBookings(range[0], range[1]);
  const dayBookings = bookings.filter((b) => b.agendaId === agenda.id && b.date === date && ["held", "confirmed"].includes(b.status));
  // Refetch free slots whenever this day's bookings change (agent or admin).
  const busyKey = dayBookings.map((b) => `${b.id}:${b.status}`).join(",");
  const agendaKey = JSON.stringify(agenda);

  useEffect(() => {
    let cancelled = false;
    getSlotsFn({ agendaId: agenda.id, date })
      .then((r) => !cancelled && setSlots(r.data.slots))
      .catch((e) => !cancelled && (toast.error((e as Error).message), setSlots([])));
    return () => {
      cancelled = true;
    };
  }, [agenda.id, date, busyKey, agendaKey]);

  const rows = [
    ...(slots ?? []).map((s) => ({ kind: "free" as const, time: s.time, slot: s })),
    ...dayBookings.map((b) => ({ kind: "booking" as const, time: b.time, booking: b })),
  ].sort((a, b) => a.time.localeCompare(b.time));

  async function act(fn: typeof confirmBookingFn, b: Booking, ok: string) {
    try {
      await fn({ bookingId: b.id });
      toast.success(ok);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon-sm" aria-label="Día anterior" onClick={() => setDate((d) => shift(d, -1))}>
          <ChevronLeft />
        </Button>
        <Input type="date" className="w-auto" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <Button variant="outline" size="icon-sm" aria-label="Día siguiente" onClick={() => setDate((d) => shift(d, 1))}>
          <ChevronRight />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setDate(todayIn(agenda.timezone))}>
          Hoy
        </Button>
        <span className="text-sm capitalize text-muted-foreground">{dayTitle(date)}</span>
      </div>

      {slots === null ? (
        <p className="text-sm text-muted-foreground">Cargando horarios…</p>
      ) : !rows.length ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          No hay horarios este día (cerrado, bloqueado, fuera de plazo o ya pasado).
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) =>
            r.kind === "free" ? (
              <li key={`f${r.time}`}>
                <button
                  className="flex w-full items-center gap-3 rounded-lg border border-dashed px-3 py-2 text-left text-sm hover:border-primary hover:bg-primary/5"
                  disabled={!canBook}
                  onClick={() => setBooking(r.slot)}
                >
                  <span className="w-12 font-mono">{r.time}</span>
                  <span className="text-muted-foreground">
                    Libre{(agenda.lanes ?? 1) > 1 ? ` (${(r.slot.lanes ?? []).join(", ")})` : ""} · reservar
                  </span>
                </button>
              </li>
            ) : (
              <li
                key={r.booking.id}
                className={cn(
                  "flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-sm",
                  r.booking.status === "held" ? "border-amber-500/50 bg-amber-500/10" : "bg-muted/50",
                )}
              >
                <span className="w-12 font-mono">
                  {r.time}
                  {r.booking.lane && <span className="ml-0.5 text-xs text-muted-foreground">{r.booking.lane}</span>}
                </span>
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  {r.booking.source === "ai" ? <Bot className="size-4 shrink-0 text-violet-500" /> : <UserRound className="size-4 shrink-0" />}
                  <span className="truncate font-medium">{r.booking.customer.name}</span>
                  {r.booking.customer.platform && <span className="text-xs text-muted-foreground">· {r.booking.customer.platform}</span>}
                  {r.booking.customer.contact && <span className="truncate text-xs text-muted-foreground">· {r.booking.customer.contact}</span>}
                  {r.booking.vehicle && <span className="truncate text-xs font-medium">· {r.booking.vehicle.title}</span>}
                </span>
                <span className={cn("flex items-center gap-1 text-xs", r.booking.status === "held" && "text-amber-700 dark:text-amber-300")}>
                  {r.booking.status === "held" && <Clock className="size-3" />}
                  {STATUS_LABEL[r.booking.status]}
                </span>
                {canBook && r.booking.status === "held" && (
                  <Button size="xs" variant="secondary" onClick={() => act(confirmBookingFn, r.booking, "Cita confirmada")}>
                    <Check /> Confirmar
                  </Button>
                )}
                {canBook && (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => confirm(`¿Cancelar la cita de ${r.booking.customer.name}?`) && act(cancelBookingFn, r.booking, "Cita cancelada")}
                >
                  <X /> Cancelar
                </Button>
                )}
                {r.booking.notes && <p className="w-full pl-15 text-xs text-muted-foreground">{r.booking.notes}</p>}
              </li>
            ),
          )}
        </ul>
      )}

      {booking && (
        <BookingModal open onOpenChange={(o) => !o && setBooking(null)} prefill={{ agendaId: agenda.id, date, time: booking.time }} />
      )}
    </div>
  );
}
