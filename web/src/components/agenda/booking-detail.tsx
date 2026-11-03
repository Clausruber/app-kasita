"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Bot, CalendarCheck, Car, Check, Clock, UserRound, X } from "lucide-react";
import { platformName } from "@/lib/platforms";
import type { Booking } from "@/lib/types";
import { STATUS_LABEL, cancelBookingFn, confirmBookingFn } from "@/components/agenda/agenda-day";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useCan } from "@/hooks/use-me";

const when = (b: Booking) =>
  new Intl.DateTimeFormat("es-ES", {
    timeZone: b.timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(b.start.toDate());

/** Calendar chip of a booking (amber while it is a hold awaiting confirmation). */
export function BookingChip({ booking, onClick }: { booking: Booking; onClick: () => void }) {
  const held = booking.status === "held";
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-xs",
        held ? "bg-amber-500/15 text-amber-800 hover:bg-amber-500/25 dark:text-amber-300" : "bg-emerald-500/15 text-emerald-800 hover:bg-emerald-500/25 dark:text-emerald-300",
      )}
    >
      {held ? <Clock className="size-3 shrink-0" /> : <CalendarCheck className="size-3 shrink-0" />}
      <span className="shrink-0 tabular-nums">
        {booking.time}
        {booking.lane}
      </span>
      <span className="truncate">
        {booking.vehicle ? booking.vehicle.title : booking.service} · {booking.customer.name}
      </span>
    </button>
  );
}

/** Booking details with confirm (holds) and cancel. */
export function BookingDetail({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const canBook = useCan()("agenda.book");
  const active = (booking.status === "held" || booking.status === "confirmed") && canBook;

  async function act(fn: typeof confirmBookingFn, ok: string) {
    setBusy(true);
    try {
      await fn({ bookingId: booking.id });
      toast.success(ok);
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarCheck className="size-5" /> {booking.service}
          </DialogTitle>
          <DialogDescription className="capitalize">{when(booking)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <p className="flex items-center gap-2">
            {booking.source === "ai" ? <Bot className="size-4 text-violet-500" /> : <UserRound className="size-4" />}
            <span className="font-medium">{booking.customer.name}</span>
            {booking.customer.platform && <span className="text-muted-foreground">· {platformName(booking.customer.platform)}</span>}
          </p>
          {booking.customer.contact && <p className="text-muted-foreground">WhatsApp: {booking.customer.contact}</p>}
          {booking.vehicle && (
            <p className="flex items-center gap-2">
              <Car className="size-4" />
              <Link href={`/dashboard/inventory/${booking.vehicle.id}`} className="font-medium hover:underline">
                {booking.vehicle.title}
              </Link>
            </p>
          )}
          {booking.lane && <p>Espacio: {booking.lane}</p>}
          <p>
            Estado: <span className={cn(booking.status === "held" && "text-amber-700 dark:text-amber-300")}>{STATUS_LABEL[booking.status]}</span>
            {" · "}
            {booking.source === "ai" ? "reservada por el agente IA" : "agendada a mano"}
          </p>
          {booking.notes && <p className="rounded-lg bg-muted px-2 py-1.5">{booking.notes}</p>}
          <Link href="/dashboard/agenda" className="inline-block text-xs text-primary hover:underline">
            Ver en la página Agenda →
          </Link>
        </div>
        <DialogFooter>
          {active && (
            <Button
              variant="ghost"
              className="mr-auto text-destructive"
              disabled={busy}
              onClick={() => confirm(`¿Cancelar la cita de ${booking.customer.name}?`) && act(cancelBookingFn, "Cita cancelada")}
            >
              <X /> Cancelar cita
            </Button>
          )}
          {active && booking.status === "held" && (
            <Button disabled={busy} onClick={() => act(confirmBookingFn, "Cita confirmada")}>
              <Check /> Confirmar
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
