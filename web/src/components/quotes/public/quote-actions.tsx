"use client";

import { useEffect, useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { CalendarCheck, CheckCircle2, MessageCircle, ThumbsUp } from "lucide-react";
import { functions } from "@/lib/firebase/client";
import { quoteFor } from "@/lib/quote-math";
import type { PublicQuote } from "@/lib/quote-public";
import type { QuoteVehicle } from "@/lib/quotes-server";
import { money } from "@/lib/vehicle-catalog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Slot = { time: string; label: string };
const slotsFn = httpsCallable<{ token: string; vehicleId: string; date: string }, { slots: Slot[]; timezone: string }>(functions, "alQuoteSlots");
const bookFn = httpsCallable<{ token: string; vehicleId: string; date: string; time: string; name: string; whatsapp: string }, { label: string; lane: string | null }>(
  functions,
  "alQuoteBook",
);

const post = async <T,>(path: string, body: unknown): Promise<T> => {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Error ${res.status}`);
  return data as T;
};

/** Counts the visit once the page is open in a real browser (link-preview bots never run this). */
export function ViewBeacon({ token }: { token: string }) {
  useEffect(() => {
    post(`/api/public/quotes/${token}/view`, {}).catch(() => {});
  }, [token]);
  return null;
}

const todayMx = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());

/** Per-car block: financing simulator, WhatsApp, test drive and "Quiero este auto". */
export function QuoteVehicleActions({ token, quote, vehicle }: { token: string; quote: PublicQuote; vehicle: QuoteVehicle }) {
  const f = quote.financing;
  const initialDown = f.downMode === "pct" ? f.down : vehicle.price ? Math.round((f.down / vehicle.price) * 100) : quote.minDownPct;
  const [downPct, setDownPct] = useState(Math.max(quote.minDownPct, Math.min(90, initialDown)));
  const terms = [...f.terms].sort((a, b) => a - b);
  const [months, setMonths] = useState(terms[Math.floor((terms.length - 1) / 2)] ?? 48);
  const showSim = quote.allowSimulation || quote.hasFinancing;
  // Trade-in: the seller's (if any) as a starting point; the customer can add or change it when simulating.
  const [withTrade, setWithTrade] = useState(!!quote.tradeIn);
  const [tradeModel, setTradeModel] = useState(quote.tradeIn?.description ?? "");
  const [tradeValue, setTradeValue] = useState(quote.tradeIn?.value ? String(quote.tradeIn.value) : "");
  const tradeAmount = Math.max(0, Math.round(Number(tradeValue.replace(/[^\d]/g, "")) || 0));
  const trade = withTrade && tradeAmount > 0 ? { description: tradeModel.trim(), value: tradeAmount } : null;
  const qt = useMemo(
    () => quoteFor(vehicle.price, { ...f, downMode: "pct", down: downPct, terms: [months] }, trade, quote.minDownPct),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vehicle.price, f, downPct, months, trade?.value, quote.minDownPct],
  );
  const payment = qt.rows[0]?.payment ?? 0;
  const expired = quote.status === "expired";
  const acceptedThis = quote.accepted?.vehicleId === vehicle.id;
  const [accepted, setAccepted] = useState(acceptedThis);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [driveOpen, setDriveOpen] = useState(false);

  const waText = `Hola, vi la cotización ${quote.folio}: me interesa el ${vehicle.title}${showSim && payment ? ` con ${downPct}% de enganche a ${months} meses (${money(payment)}/mes)` : ""}${trade ? `, dejando a cuenta mi ${trade.description || "auto"} (${money(trade.value)})` : ""}.`;
  const waHref = quote.company.whatsapp ? `https://wa.me/${quote.company.whatsapp}?text=${encodeURIComponent(waText)}` : null;

  const [confirmOpen, setConfirmOpen] = useState(false);

  async function accept() {
    setBusy(true);
    setError("");
    try {
      await post(`/api/public/quotes/${token}/accept`, { vehicleId: vehicle.id, downPct: showSim ? downPct : null, months: showSim ? months : null, tradeIn: trade });
      setAccepted(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 border-t pt-3">
      {showSim && (
        <div className="space-y-3 rounded-xl bg-muted/60 p-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-medium">{quote.allowSimulation ? "Simula tu financiamiento" : "Plan de financiamiento"}</p>
            <p className="text-right">
              <span className="text-xl font-bold">{money(payment)}</span>
              <span className="text-xs text-muted-foreground"> /mes</span>
            </p>
          </div>
          {quote.allowSimulation && (
            <>
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <Label htmlFor={`down-${vehicle.id}`}>Enganche</Label>
                  <span className="tabular-nums">
                    {downPct}% · {money(qt.cashDown)}
                  </span>
                </div>
                <input
                  id={`down-${vehicle.id}`}
                  type="range"
                  min={quote.minDownPct}
                  max={90}
                  step={5}
                  value={downPct}
                  onChange={(e) => setDownPct(Number(e.target.value))}
                  className="w-full accent-primary"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {terms.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setMonths(t)}
                    className={cn("rounded-full border px-3 py-1 text-xs", t === months ? "border-primary bg-primary text-primary-foreground" : "bg-background")}
                  >
                    {t} meses
                  </button>
                ))}
              </div>
              <div className="space-y-2 rounded-lg border bg-background p-2.5">
                <label className="flex items-center gap-2 text-xs font-medium">
                  <input type="checkbox" className="size-4 accent-primary" checked={withTrade} onChange={(e) => setWithTrade(e.target.checked)} />
                  Tengo un auto para dejar a cuenta
                </label>
                {withTrade && (
                  <div className="grid gap-2 sm:grid-cols-[1fr_10rem]">
                    <div className="space-y-1">
                      <Label htmlFor={`trade-model-${vehicle.id}`} className="text-xs">
                        Modelo
                      </Label>
                      <Input id={`trade-model-${vehicle.id}`} placeholder="Ej. Nissan Versa 2018, 80,000 km" maxLength={200} value={tradeModel} onChange={(e) => setTradeModel(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`trade-value-${vehicle.id}`} className="text-xs">
                        Valor estimado (MXN)
                      </Label>
                      <div className="relative">
                        <span className="pointer-events-none absolute top-1.5 left-2 text-sm text-muted-foreground">$</span>
                        <Input
                          id={`trade-value-${vehicle.id}`}
                          inputMode="numeric"
                          className="pl-5"
                          placeholder="150,000"
                          value={tradeAmount ? tradeAmount.toLocaleString("es-MX") : tradeValue.replace(/[^\d]/g, "")}
                          onChange={(e) => setTradeValue(e.target.value)}
                        />
                      </div>
                    </div>
                    <p className="text-[11px] text-muted-foreground sm:col-span-2">El valor final se confirma al revisar tu auto.</p>
                  </div>
                )}
              </div>
            </>
          )}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            {trade && (
              <>
                <dt className="text-muted-foreground">Auto a cuenta</dt>
                <dd className="text-right">- {money(qt.tradeIn)}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Enganche</dt>
            <dd className="text-right">- {money(qt.cashDown)}</dd>
            <dt className="text-muted-foreground">A financiar</dt>
            <dd className="text-right font-medium">{money(qt.financed)}</dd>
            <dt className="text-muted-foreground">Plazo y tasa</dt>
            <dd className="text-right">
              {months} meses · {f.rate}%{f.ivaOnInterest ? " + IVA" : ""}
            </dd>
          </dl>
          {qt.warnings.map((w) => (
            <p key={w} className="text-xs text-amber-700 dark:text-amber-300">
              {w}
            </p>
          ))}
          <p className="text-[11px] text-muted-foreground">Cálculo informativo; el financiamiento está sujeto a aprobación de crédito.</p>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-3">
        {waHref && (
          <Button nativeButton={false} variant="outline" className="border-emerald-600 text-emerald-700 dark:text-emerald-300" render={<a href={waHref} target="_blank" rel="noreferrer" />}>
            <MessageCircle /> WhatsApp
          </Button>
        )}
        {quote.testDrive && !expired && (
          <Button variant="outline" onClick={() => setDriveOpen(true)}>
            <CalendarCheck /> Prueba de manejo
          </Button>
        )}
        {!expired && (
          <Button disabled={busy || accepted || (!!quote.accepted && !acceptedThis)} onClick={() => (setError(""), setConfirmOpen(true))}>
            {accepted ? <CheckCircle2 /> : <ThumbsUp />} {accepted ? "¡Listo! Te contactamos" : "Quiero este auto"}
          </Button>
        )}
      </div>
      {error && !confirmOpen && <p className="text-xs text-destructive">{error}</p>}
      {confirmOpen && (
        <Dialog open onOpenChange={(o) => !o && !busy && setConfirmOpen(false)}>
          <DialogContent className="sm:max-w-md">
            {accepted ? (
              <div className="space-y-4 py-2 text-center">
                <CheckCircle2 className="mx-auto size-12 text-emerald-500" />
                <DialogHeader>
                  <DialogTitle className="text-center">¡Gracias! Ya le avisamos a tu asesor</DialogTitle>
                  <DialogDescription className="text-center">
                    {quote.sellerName ? `${quote.sellerName} te contactará` : "Un asesor te contactará"} en breve para dar seguimiento a tu {vehicle.title}.
                  </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
                  {waHref && (
                    <Button nativeButton={false} variant="outline" className="border-emerald-600 text-emerald-700 dark:text-emerald-300" render={<a href={waHref} target="_blank" rel="noreferrer" />}>
                      <MessageCircle /> Escribir por WhatsApp
                    </Button>
                  )}
                  <Button onClick={() => setConfirmOpen(false)}>Listo</Button>
                </div>
              </div>
            ) : (
              <>
                <DialogHeader>
                  <DialogTitle>¿Te interesa este auto?</DialogTitle>
                  <DialogDescription>Confirma y tu asesor te contactará para dar seguimiento con estas condiciones.</DialogDescription>
                </DialogHeader>
                <div className="flex items-center gap-3 rounded-lg border p-2">
                  {vehicle.photos[0] && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={vehicle.photos[0]} alt="" className="size-16 shrink-0 rounded object-cover" />
                  )}
                  <div className="min-w-0">
                    <p className="truncate font-medium">{vehicle.title}</p>
                    <p className="text-sm font-semibold text-primary">{money(vehicle.price)}</p>
                  </div>
                </div>
                {showSim && (
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                    <dt className="text-muted-foreground">Enganche</dt>
                    <dd className="text-right">
                      {downPct}% · {money(qt.cashDown)}
                    </dd>
                    {trade && (
                      <>
                        <dt className="text-muted-foreground">Auto a cuenta</dt>
                        <dd className="text-right">
                          {trade.description || "Mi auto"} · {money(trade.value)}
                        </dd>
                      </>
                    )}
                    <dt className="text-muted-foreground">A financiar</dt>
                    <dd className="text-right">{money(qt.financed)}</dd>
                    <dt className="text-muted-foreground">Plazo</dt>
                    <dd className="text-right">{months} meses</dd>
                    <dt className="font-medium">Mensualidad</dt>
                    <dd className="text-right text-base font-bold">{money(payment)}</dd>
                  </dl>
                )}
                <p className="text-[11px] text-muted-foreground">Cálculo informativo; el financiamiento está sujeto a aprobación de crédito.</p>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <DialogFooter>
                  <Button variant="outline" disabled={busy} onClick={() => setConfirmOpen(false)}>
                    Cancelar
                  </Button>
                  <Button disabled={busy} onClick={accept}>
                    <ThumbsUp /> {busy ? "Enviando…" : "Confirmar"}
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      )}
      {driveOpen && quote.testDrive && (
        <TestDriveDialog token={token} vehicle={vehicle} service={quote.testDrive.service} defaultName={quote.clientName} whatsappHint={quote.clientWhatsappHint} hasBooking={quote.hasBooking} onClose={() => setDriveOpen(false)} />
      )}
    </div>
  );
}

function TestDriveDialog({
  token,
  vehicle,
  service,
  defaultName,
  whatsappHint,
  hasBooking,
  onClose,
}: {
  token: string;
  vehicle: QuoteVehicle;
  service: string;
  defaultName: string;
  whatsappHint: string | null;
  hasBooking: boolean;
  onClose: () => void;
}) {
  const [date, setDate] = useState("");
  const [loaded, setLoaded] = useState<{ date: string; slots: Slot[] } | null>(null);
  const slots = loaded?.date === date ? loaded.slots : null;
  const [time, setTime] = useState("");
  const [name, setName] = useState(defaultName);
  const [editName, setEditName] = useState(false);
  const [whatsapp, setWhatsapp] = useState("");
  const [editWhatsapp, setEditWhatsapp] = useState(false);
  // Empty WhatsApp = the server uses the one saved with the quote.
  const useKnownWhatsapp = !!whatsappHint && !editWhatsapp;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!date) return;
    let cancelled = false;
    slotsFn({ token, vehicleId: vehicle.id, date })
      .then((r) => !cancelled && setLoaded({ date, slots: r.data.slots }))
      .catch((e) => !cancelled && (setError((e as Error).message), setLoaded({ date, slots: [] })));
    return () => {
      cancelled = true;
    };
  }, [date, token, vehicle.id]);

  async function book() {
    setBusy(true);
    setError("");
    try {
      const r = await bookFn({ token, vehicleId: vehicle.id, date, time, name, whatsapp: useKnownWhatsapp ? "" : whatsapp });
      setDone(r.data.label);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{service}</DialogTitle>
          <DialogDescription>{vehicle.title}</DialogDescription>
        </DialogHeader>
        {done ? (
          <p className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-3 text-sm text-emerald-900 dark:text-emerald-200">
            <CheckCircle2 className="size-5 shrink-0" /> ¡Listo! Te esperamos el <span className="capitalize">{done}</span>.
          </p>
        ) : hasBooking ? (
          <p className="text-sm text-muted-foreground">Ya tienes una prueba de manejo agendada con esta cotización. Si necesitas cambiarla, escríbenos por WhatsApp.</p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="td-date">Día</Label>
                <Input id="td-date" type="date" min={todayMx()} value={date} onChange={(e) => (setDate(e.target.value), setTime(""))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="td-time">Hora</Label>
                <select
                  id="td-time"
                  className="h-8 w-full rounded-lg border bg-background px-2 text-sm disabled:opacity-50"
                  disabled={!slots?.length}
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                >
                  <option value="">{!date ? "Elige un día" : slots === null ? "Cargando…" : slots.length ? "Elige la hora" : "Sin horarios"}</option>
                  {slots?.map((s) => (
                    <option key={s.time} value={s.time}>
                      {s.time}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {/* Who is booking: already known from the quote; only asked when missing (or to change it). */}
            {defaultName && !editName ? (
              <p className="flex items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
                <span>
                  A nombre de <strong>{name}</strong>
                </span>
                <button type="button" className="text-xs text-primary hover:underline" onClick={() => setEditName(true)}>
                  Cambiar
                </button>
              </p>
            ) : (
              <div className="space-y-1">
                <Label htmlFor="td-name">Nombre</Label>
                <Input id="td-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
            )}
            {whatsappHint && !editWhatsapp ? (
              <p className="flex items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
                <span>
                  Te confirmamos al WhatsApp terminación <strong>{whatsappHint}</strong>
                </span>
                <button type="button" className="text-xs text-primary hover:underline" onClick={() => setEditWhatsapp(true)}>
                  Cambiar
                </button>
              </p>
            ) : (
              <div className="space-y-1">
                <Label htmlFor="td-wa">WhatsApp</Label>
                <Input id="td-wa" type="tel" placeholder="+52 81 1234 5678" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
              </div>
            )}
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cerrar
          </Button>
          {!done && !hasBooking && (
            <Button disabled={busy || !date || !time || !name.trim() || (!useKnownWhatsapp && whatsapp.replace(/\D/g, "").length < 8)} onClick={book}>
              <CalendarCheck /> {busy ? "Agendando…" : "Agendar"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
