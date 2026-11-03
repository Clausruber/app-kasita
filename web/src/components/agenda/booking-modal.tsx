"use client";

import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarCheck, CircleCheck, UserPlus, UserRound } from "lucide-react";
import { functions } from "@/lib/firebase/client";
import { useAgendas } from "@/hooks/use-firestore";
import { useVehicles } from "@/hooks/use-vehicles";
import { money } from "@/lib/vehicle-catalog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCan } from "@/hooks/use-me";

type Slot = { time: string; label: string; lanes: string[] };
type Booked = {
  service: string;
  label: string;
  lane: string | null;
  vehicle: { id: string; title: string } | null;
  client: { id: string; name: string; created: boolean };
};
type BookInput = {
  agendaId: string;
  date: string;
  time: string;
  vehicleId?: string;
  lane?: string;
  customer: { clientId?: string; firstName: string; lastName: string; whatsapp: string };
};

const slotsFn = httpsCallable<{ agendaId: string; date: string; vehicleId?: string }, { slots: Slot[] }>(functions, "alGetSlots");
const bookFn = httpsCallable<BookInput, Booked>(functions, "alBookSlot");

export type BookingPrefill = {
  agendaId?: string;
  vehicleId?: string;
  date?: string;
  time?: string;
  client?: { id: string; firstName: string; lastName: string; whatsapp: string };
};

const todayIn = (tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const select = "h-8 w-full rounded-lg border bg-background px-2 text-sm disabled:opacity-50";

/**
 * "Agendar" modal: service → date → free slot → client (name, surname, WhatsApp) → book.
 * The client is matched by WhatsApp or created; a success step confirms the booking.
 */
export function BookingModal({ open, onOpenChange, prefill }: { open: boolean; onOpenChange: (o: boolean) => void; prefill?: BookingPrefill }) {
  const qc = useQueryClient();
  const { data: all } = useAgendas();
  const agendas = all.filter((a) => a.active);
  const [chosenAgenda, setAgendaId] = useState(prefill?.agendaId ?? "");
  // Single service: chosen for the user.
  const agendaId = chosenAgenda || (agendas.length === 1 ? agendas[0].id : "");
  const agenda = agendas.find((a) => a.id === agendaId) ?? null;
  const needsCar = !!agenda?.vehicleRequired;
  const multiLane = (agenda?.lanes ?? 1) > 1;
  // Cars for test drives: only what is on sale (loaded only when the agenda asks for a car).
  const inventory = useVehicles(needsCar);
  const cars = (inventory.data?.vehicles ?? []).filter((v) => v.status === "disponible" || v.status === "apartado");
  const [chosenCar, setCar] = useState(prefill?.vehicleId ?? "");
  const vehicleId = needsCar ? chosenCar : "";
  const [date, setDate] = useState(prefill?.date ?? "");
  const [chosenTime, setTime] = useState(prefill?.time ?? "");
  const [chosenLane, setLane] = useState("");
  // Free slots of the selected service+car+date (stale results of a previous selection are ignored).
  const key = `${agendaId}|${vehicleId}|${date}`;
  const [loaded, setLoaded] = useState<{ key: string; slots: Slot[] } | null>(null);
  const slots = loaded?.key === key ? loaded.slots : null;
  const slot = slots?.find((s) => s.time === chosenTime) ?? null;
  const time = slot ? chosenTime : "";
  // Empty = first free sub-space.
  const lane = slot?.lanes?.includes(chosenLane) ? chosenLane : "";
  const [firstName, setFirstName] = useState(prefill?.client?.firstName ?? "");
  const [lastName, setLastName] = useState(prefill?.client?.lastName ?? "");
  const [whatsapp, setWhatsapp] = useState(prefill?.client?.whatsapp ?? "");
  const [saving, setSaving] = useState(false);
  const [booked, setBooked] = useState<Booked | null>(null);

  useEffect(() => {
    if (!agendaId || !date || (needsCar && !vehicleId)) return;
    let cancelled = false;
    const k = `${agendaId}|${vehicleId}|${date}`;
    slotsFn({ agendaId, date, ...(vehicleId ? { vehicleId } : {}) })
      .then((r) => !cancelled && setLoaded({ key: k, slots: r.data.slots }))
      .catch((e) => !cancelled && (toast.error((e as Error).message), setLoaded({ key: k, slots: [] })));
    return () => {
      cancelled = true;
    };
  }, [agendaId, date, vehicleId, needsCar]);

  const canBook = agendaId && (!needsCar || vehicleId) && date && time && firstName.trim() && (whatsapp.trim() || prefill?.client);

  async function book() {
    setSaving(true);
    try {
      const r = await bookFn({
        agendaId,
        date,
        time,
        ...(vehicleId ? { vehicleId } : {}),
        ...(lane ? { lane } : {}),
        customer: { ...(prefill?.client ? { clientId: prefill.client.id } : {}), firstName, lastName, whatsapp },
      });
      setBooked(r.data);
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["client"] });
    } catch (e) {
      toast.error((e as Error).message);
      // The slot may have just been taken: refresh the list.
      if (agendaId && date) slotsFn({ agendaId, date, ...(vehicleId ? { vehicleId } : {}) }).then((r) => setLoaded({ key, slots: r.data.slots })).catch(() => {});
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {booked ? (
          <div className="space-y-4 py-2 text-center">
            <CircleCheck className="mx-auto size-14 text-emerald-500" />
            <DialogHeader>
              <DialogTitle className="text-center text-lg">¡Cita agendada!</DialogTitle>
              <DialogDescription className="text-center">
                {booked.service} · <span className="capitalize">{booked.label}</span>
                {booked.lane && ` · espacio ${booked.lane}`}
                {booked.vehicle && <span className="mt-1 block font-medium text-foreground">{booked.vehicle.title}</span>}
              </DialogDescription>
            </DialogHeader>
            <p className="flex items-center justify-center gap-1.5 text-sm">
              {booked.client.created ? <UserPlus className="size-4 text-emerald-600" /> : <UserRound className="size-4" />}
              {booked.client.name}
              <span className="text-muted-foreground">· {booked.client.created ? "cliente nuevo registrado" : "cliente existente"}</span>
            </p>
            <Button className="w-full" onClick={() => onOpenChange(false)}>
              Listo
            </Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CalendarCheck className="size-5" /> Agendar cita
              </DialogTitle>
            </DialogHeader>

            {!agendas.length ? (
              <p className="text-sm text-muted-foreground">Primero crea una agenda de servicio en Ajustes → Agendas de servicios.</p>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="bm-service">1. Servicio</Label>
                  <select id="bm-service" className={select} value={agendaId} onChange={(e) => setAgendaId(e.target.value)}>
                    <option value="">Selecciona un servicio…</option>
                    {agendas.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.service} · {a.durationMin} min{a.price ? ` · ${a.price}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                {needsCar && (
                  <div className="space-y-1">
                    <Label htmlFor="bm-car">Auto a probar</Label>
                    <select id="bm-car" className={select} value={vehicleId} onChange={(e) => setCar(e.target.value)} disabled={inventory.isLoading}>
                      <option value="">
                        {inventory.isLoading ? "Cargando inventario…" : inventory.error ? "Sin acceso al inventario" : cars.length ? "Selecciona el auto…" : "No hay autos disponibles"}
                      </option>
                      {cars.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.title || `${v.brand} ${v.model} ${v.year}`} · {money(v.price)}
                          {v.stockNumber ? ` · ${v.stockNumber}` : ""}
                          {v.status === "apartado" ? " · apartado" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="bm-date">2. Fecha</Label>
                    <Input
                      id="bm-date"
                      type="date"
                      disabled={!agenda || (needsCar && !vehicleId)}
                      min={agenda ? todayIn(agenda.timezone) : undefined}
                      max={agenda ? addDays(todayIn(agenda.timezone), agenda.maxDaysAhead) : undefined}
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="bm-slot">3. Horario</Label>
                    <select id="bm-slot" className={select} disabled={!date || !slots?.length} value={time} onChange={(e) => setTime(e.target.value)}>
                      <option value="">
                        {!date ? "Elige una fecha" : slots === null ? "Cargando…" : slots.length ? `${slots.length} horarios libres` : "Sin horarios libres"}
                      </option>
                      {slots?.map((s) => (
                        <option key={s.time} value={s.time}>
                          {s.time}
                          {multiLane ? ` · libre: ${(s.lanes ?? []).join(", ")}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {multiLane && slot && (
                  <div className="space-y-1">
                    <Label>Espacio</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {["", ...(slot.lanes ?? [])].map((l) => (
                        <button
                          key={l || "auto"}
                          type="button"
                          onClick={() => setLane(l)}
                          className={`rounded-md border px-2.5 py-1 text-sm ${lane === l ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                        >
                          {l ? `Espacio ${l}` : "El primero libre"}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <p className="pt-1 text-sm font-medium">4. Cliente</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="bm-first">Nombre</Label>
                    <Input id="bm-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="bm-last">Apellidos</Label>
                    <Input id="bm-last" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label htmlFor="bm-wa">WhatsApp</Label>
                    <Input id="bm-wa" type="tel" placeholder="+5511987654321" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
                    <p className="text-xs text-muted-foreground">
                      {prefill?.client ? "Se guardará en la ficha de este cliente." : "Si no hay ningún cliente con este WhatsApp, se registra uno nuevo."}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button disabled={!canBook || saving} onClick={book}>
                <CalendarCheck /> {saving ? "Agendando…" : "Agendar"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** "Agendar" button that opens the modal (optionally prefilled). */
export function BookButton({ prefill, size = "default", variant = "default" }: { prefill?: BookingPrefill; size?: "default" | "sm"; variant?: "default" | "outline" }) {
  const [open, setOpen] = useState(false);
  const canBook = useCan()("agenda.book");
  if (!canBook) return null;
  return (
    <>
      <Button size={size} variant={variant} onClick={() => setOpen(true)}>
        <CalendarCheck /> Agendar
      </Button>
      {/* Mounted only while open so every opening starts clean. */}
      {open && <BookingModal open onOpenChange={setOpen} prefill={prefill} />}
    </>
  );
}
