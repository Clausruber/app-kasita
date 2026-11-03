"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Car, ChevronDown, Link2, Plus, Search, X } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { MAX_CATALOG_VEHICLES, QUOTE_DEFAULTS, TERM_OPTIONS, quoteFor, type Financing, type QuoteDefaults } from "@/lib/quote-math";
import { BODY_TYPES, TRANSMISSIONS, money } from "@/lib/vehicle-catalog";
import type { Client, Vehicle } from "@/lib/types";
import { useVehicles } from "@/hooks/use-vehicles";
import { HoldWarning } from "@/components/inventory/hold-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type QuotePrefill = { vehicleIds?: string[]; clientId?: string | null; clientName?: string; clientWhatsapp?: string; conversationId?: string | null; dealId?: string | null };

/** A quote as the API returns it (list, create). `path` is the public page (/c/{token}). */
export type QuoteRow = {
  id: string;
  folio: string;
  path: string | null;
  status: "sent" | "viewed" | "accepted" | "expired";
  views: number;
  lastViewedAt: string | null;
  validUntil: string;
  accepted: { vehicleTitle: string; downPct: number; months: number | null; tradeIn?: { description: string; value: number } | null } | null;
  clientId: string | null;
  clientName: string;
  clientWhatsapp: string;
  vehicles: { id: string; title: string; price: number }[];
  financing: boolean;
  sellerName: string;
  createdAt: string | null;
  fileName?: string;
};

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const titleOf = (v: Vehicle) => v.title || `${v.brand} ${v.model} ${v.year}`;
const select = "h-8 w-full rounded-lg border bg-background px-2 text-sm";

/** Defaults for the financing section (Ajustes → Empresa → Cotizaciones). */
export function useQuoteDefaults() {
  const { user } = useAuth();
  return useQuery({ queryKey: ["quote-defaults", user?.uid], enabled: !!user, queryFn: () => api<QuoteDefaults>("/api/settings/quotes") });
}

type Filters = { brand: string; body: string; transmission: string; priceMin: string; priceMax: string; yearMin: string; kmMax: string };
const NO_FILTERS: Filters = { brand: "", body: "", transmission: "", priceMin: "", priceMax: "", yearMin: "", kmMax: "" };

/**
 * Quote form shared by the catalog drawer (`variant="compact"`) and the Cotizaciones page (`"full"`:
 * inventory filters and client picker). Creates the quote and hands the row to `onCreated`.
 */
export function QuoteBuilder({
  variant,
  prefill,
  enabled = true,
  actionLabel,
  onCreated,
  onCancel,
}: {
  variant: "compact" | "full";
  prefill?: QuotePrefill;
  enabled?: boolean;
  actionLabel: string;
  onCreated: (row: QuoteRow) => void;
  onCancel?: () => void;
}) {
  const full = variant === "full";
  const qc = useQueryClient();
  const inventory = useVehicles(enabled);
  const defaults = useQuoteDefaults().data ?? QUOTE_DEFAULTS;
  const clients = useQuery({ queryKey: ["clients"], enabled: enabled && full, queryFn: () => api<{ clients: Client[] }>("/api/clients") });
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const setFilter = (k: keyof Filters, v: string) => setFilters((f) => ({ ...f, [k]: v }));
  const [picked, setPicked] = useState<string[]>(prefill?.vehicleIds?.slice(0, MAX_CATALOG_VEHICLES) ?? []);
  const [client, setClient] = useState({ id: prefill?.clientId ?? null, name: prefill?.clientName ?? "", whatsapp: prefill?.clientWhatsapp ?? "" });
  const [clientQuery, setClientQuery] = useState("");
  const [withFinancing, setWithFinancing] = useState(false);
  const [allowSimulation, setAllowSimulation] = useState(true);
  // null = not edited yet: follow the saved defaults.
  const [fin, setFin] = useState<Financing | null>(null);
  const financing: Financing = fin ?? { downMode: "pct", down: defaults.minDownPct, rate: defaults.rate, terms: defaults.terms, ivaOnInterest: defaults.ivaOnInterest };
  const setF = <K extends keyof Financing>(k: K, v: Financing[K]) => setFin({ ...financing, [k]: v });
  const [withTrade, setWithTrade] = useState(false);
  const [trade, setTrade] = useState({ description: "", value: 0 });
  const [validDays, setValidDays] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const available = useMemo(() => (inventory.data?.vehicles ?? []).filter((v) => v.status === "disponible" || v.status === "apartado"), [inventory.data]);
  const brands = useMemo(() => [...new Set(available.map((v) => v.brand).filter(Boolean))].sort(), [available]);
  const byId = useMemo(() => new Map(available.map((v) => [v.id, v])), [available]);
  const chosen = picked.map((id) => byId.get(id)).filter((v): v is Vehicle => !!v);
  const results = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    const n = (s: string) => (s ? Number(s) : null);
    const [pMin, pMax, yMin, kMax] = [n(filters.priceMin), n(filters.priceMax), n(filters.yearMin), n(filters.kmMax)];
    return available
      .filter((v) => !picked.includes(v.id))
      .filter((v) => {
        const text = norm([v.title, v.brand, v.model, v.trim, v.year, v.color, v.bodyType, v.transmission, v.fuel, v.stockNumber].join(" "));
        if (!words.every((w) => text.includes(w))) return false;
        if (filters.brand && v.brand !== filters.brand) return false;
        if (filters.body && v.bodyType !== filters.body) return false;
        if (filters.transmission && v.transmission !== filters.transmission) return false;
        if (pMin !== null && v.price < pMin) return false;
        if (pMax !== null && v.price > pMax) return false;
        if (yMin !== null && v.year < yMin) return false;
        if (kMax !== null && v.km > kMax) return false;
        return true;
      })
      .sort((a, b) => a.price - b.price)
      .slice(0, full ? 60 : 30);
  }, [available, picked, q, filters, full]);
  const isFull = picked.length >= MAX_CATALOG_VEHICLES;
  const clientMatches = useMemo(() => {
    const term = norm(clientQuery.trim());
    if (!term) return [];
    return (clients.data?.clients ?? [])
      .filter((c) => norm([c.firstName, c.lastName, c.displayName, c.username, c.whatsapp].join(" ")).includes(term))
      .slice(0, 6);
  }, [clients.data, clientQuery]);

  const add = (id: string) => (isFull ? toast.error(`Máximo ${MAX_CATALOG_VEHICLES} autos`) : setPicked((p) => [...p, id]));
  const move = (i: number, d: -1 | 1) =>
    setPicked((p) => {
      const next = [...p];
      [next[i], next[i + d]] = [next[i + d], next[i]];
      return next;
    });

  async function generate() {
    setBusy(true);
    try {
      const row = await api<QuoteRow>("/api/quotes", {
        method: "POST",
        body: {
          vehicleIds: chosen.map((v) => v.id),
          clientId: client.id,
          clientName: client.name.trim(),
          clientWhatsapp: client.whatsapp.trim(),
          conversationId: prefill?.conversationId ?? null,
          dealId: prefill?.dealId ?? null,
          financing: withFinancing ? financing : null,
          tradeIn: withTrade && trade.value > 0 ? trade : null,
          allowSimulation,
          validDays: validDays ?? defaults.validDays,
          notes,
        },
      });
      qc.invalidateQueries({ queryKey: ["quotes"] });
      onCreated(row);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={cn("min-h-0 flex-1 space-y-4 overflow-y-auto", full ? "" : "px-4 py-3")}>
        {/* Selected */}
        <section className="space-y-1.5">
          <Label>
            Autos seleccionados ({chosen.length}/{MAX_CATALOG_VEHICLES})
          </Label>
          {!chosen.length && <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">Busca y agrega autos abajo.</p>}
          <ul className="space-y-1.5">
            {chosen.map((v, i) => {
              const qt = withFinancing ? quoteFor(v.price, financing, withTrade ? trade : null, defaults.minDownPct) : null;
              const mid = qt?.rows[Math.floor((qt.rows.length - 1) / 2)];
              return (
                <li key={v.id} className="flex items-center gap-2 rounded-lg border p-1.5">
                  <Thumb v={v} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{titleOf(v)}</p>
                    <p className="text-xs text-muted-foreground">
                      {money(v.price)}
                      {mid && mid.payment > 0 && ` · ${money(mid.payment)}/mes a ${mid.months}`}
                    </p>
                    {qt?.warnings.map((w) => (
                      <p key={w} className="text-[11px] text-amber-700 dark:text-amber-300">
                        {w}
                      </p>
                    ))}
                    <HoldWarning hold={v.hold} />
                  </div>
                  <div className="flex flex-col">
                    <Button variant="ghost" size="icon-xs" aria-label="Subir" disabled={i === 0} onClick={() => move(i, -1)}>
                      <ArrowUp />
                    </Button>
                    <Button variant="ghost" size="icon-xs" aria-label="Bajar" disabled={i === chosen.length - 1} onClick={() => move(i, 1)}>
                      <ArrowDown />
                    </Button>
                  </div>
                  <Button variant="ghost" size="icon-xs" aria-label="Quitar" onClick={() => setPicked((p) => p.filter((x) => x !== v.id))}>
                    <X />
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Search + filters */}
        <section className="space-y-2">
          <div className="relative">
            <Search className="absolute top-2 left-2 size-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Buscar marca, modelo, año, color…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {full && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <select aria-label="Marca" className={select} value={filters.brand} onChange={(e) => setFilter("brand", e.target.value)}>
                <option value="">Todas las marcas</option>
                {brands.map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
              <select aria-label="Carrocería" className={select} value={filters.body} onChange={(e) => setFilter("body", e.target.value)}>
                <option value="">Carrocería</option>
                {BODY_TYPES.map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
              <select aria-label="Transmisión" className={select} value={filters.transmission} onChange={(e) => setFilter("transmission", e.target.value)}>
                <option value="">Transmisión</option>
                {TRANSMISSIONS.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
              <Input type="number" min={1950} placeholder="Año desde" value={filters.yearMin} onChange={(e) => setFilter("yearMin", e.target.value)} />
              <Input type="number" min={0} placeholder="Precio mín." value={filters.priceMin} onChange={(e) => setFilter("priceMin", e.target.value)} />
              <Input type="number" min={0} placeholder="Precio máx." value={filters.priceMax} onChange={(e) => setFilter("priceMax", e.target.value)} />
              <Input type="number" min={0} placeholder="Km máx." value={filters.kmMax} onChange={(e) => setFilter("kmMax", e.target.value)} />
              <Button variant="ghost" size="sm" disabled={JSON.stringify(filters) === JSON.stringify(NO_FILTERS) && !q} onClick={() => (setFilters(NO_FILTERS), setQ(""))}>
                Limpiar filtros
              </Button>
            </div>
          )}
          {inventory.isLoading && <p className="text-xs text-muted-foreground">Cargando inventario…</p>}
          {inventory.error && <p className="text-xs text-destructive">{(inventory.error as Error).message}</p>}
          <ul className={cn("space-y-1 overflow-y-auto", full ? "grid max-h-[28rem] gap-2 space-y-0 sm:grid-cols-2" : "max-h-64")}>
            {results.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  disabled={isFull}
                  onClick={() => add(v.id)}
                  className={cn("flex w-full items-center gap-2 rounded-lg p-1.5 text-left hover:bg-muted disabled:opacity-50", full && "border")}
                >
                  <Thumb v={v} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{titleOf(v)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {money(v.price)} · {v.km ? `${v.km.toLocaleString("es-MX")} km` : "0 km"}
                      {v.status === "apartado" && " · apartado"}
                    </span>
                  </span>
                  <Plus className="size-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            ))}
            {!inventory.isLoading && !results.length && <li className="px-2 py-3 text-center text-xs text-muted-foreground">Sin resultados.</li>}
          </ul>
        </section>

        {/* Client */}
        {full ? (
          <section className="space-y-2 rounded-lg border p-3">
            <Label>Cliente</Label>
            {client.id ? (
              <div className="flex items-center gap-2 rounded-lg bg-muted px-2 py-1.5 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  {client.name}
                  {client.whatsapp && <span className="text-muted-foreground"> · {client.whatsapp}</span>}
                </span>
                <Button variant="ghost" size="icon-xs" aria-label="Quitar cliente" onClick={() => setClient({ id: null, name: "", whatsapp: "" })}>
                  <X />
                </Button>
              </div>
            ) : (
              <div className="relative">
                <Input placeholder="Buscar cliente por nombre o WhatsApp…" value={clientQuery} onChange={(e) => setClientQuery(e.target.value)} />
                {clientMatches.length > 0 && (
                  <ul className="absolute inset-x-0 top-9 z-10 rounded-lg border bg-popover p-1 shadow-md">
                    {clientMatches.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                          onClick={() => {
                            setClient({ id: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.displayName, whatsapp: c.whatsapp });
                            setClientQuery("");
                          }}
                        >
                          {[c.firstName, c.lastName].filter(Boolean).join(" ") || c.displayName}
                          <span className="text-xs text-muted-foreground"> · {c.whatsapp || c.username || c.platform}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {!client.id && (
              <div className="grid gap-2 sm:grid-cols-2">
                <Input placeholder="…o escribe el nombre" value={client.name} onChange={(e) => setClient({ ...client, name: e.target.value })} />
                <Input type="tel" placeholder="WhatsApp (para enviarla)" value={client.whatsapp} onChange={(e) => setClient({ ...client, whatsapp: e.target.value })} />
              </div>
            )}
          </section>
        ) : null}

        {/* Financing */}
        <section className="space-y-2 rounded-lg border p-3">
          <label className="flex items-center gap-2 font-medium">
            <Checkbox checked={withFinancing} onCheckedChange={(c) => setWithFinancing(c === true)} /> Incluir financiamiento
          </label>
          {withFinancing && (
            <div className="space-y-3 pt-1">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="qb-down">Enganche</Label>
                  <div className="flex gap-1">
                    <Input id="qb-down" type="number" min={0} value={financing.down} onChange={(e) => setF("down", Number(e.target.value))} />
                    <select aria-label="Tipo de enganche" className="h-8 rounded-lg border bg-background px-1 text-sm" value={financing.downMode} onChange={(e) => setF("downMode", e.target.value as Financing["downMode"])}>
                      <option value="pct">%</option>
                      <option value="amount">$</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="qb-rate">Tasa anual (%)</Label>
                  <Input id="qb-rate" type="number" min={0} step={0.1} value={financing.rate} onChange={(e) => setF("rate", Number(e.target.value))} />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Plazos (meses)</Label>
                <div className="flex flex-wrap gap-1.5">
                  {TERM_OPTIONS.map((t) => {
                    const on = financing.terms.includes(t);
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setF("terms", on ? financing.terms.filter((x) => x !== t) : [...financing.terms, t].sort((a, b) => a - b))}
                        className={cn("rounded-md border px-2.5 py-1 text-xs", on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs">
                <Checkbox checked={financing.ivaOnInterest} onCheckedChange={(c) => setF("ivaOnInterest", c === true)} /> IVA sobre intereses
              </label>
            </div>
          )}
          <label className="flex items-center gap-2 text-xs">
            <Checkbox checked={allowSimulation} onCheckedChange={(c) => setAllowSimulation(c === true)} /> Permitir que el cliente simule el financiamiento en el link
          </label>
        </section>

        {/* Trade-in */}
        <section className="space-y-2 rounded-lg border p-3">
          <label className="flex items-center gap-2 font-medium">
            <Checkbox checked={withTrade} onCheckedChange={(c) => setWithTrade(c === true)} /> Auto a cuenta
          </label>
          {withTrade && (
            <div className="grid grid-cols-[1fr_8rem] gap-2">
              <Input placeholder="Nissan Versa 2016, 120,000 km" value={trade.description} onChange={(e) => setTrade({ ...trade, description: e.target.value })} />
              <Input type="number" min={0} placeholder="Valor $" value={trade.value || ""} onChange={(e) => setTrade({ ...trade, value: Number(e.target.value) })} />
            </div>
          )}
        </section>

        {/* Extras */}
        <details className="group rounded-lg border p-3">
          <summary className="flex cursor-pointer list-none items-center justify-between font-medium">
            {full ? "Vigencia y notas" : "Cliente, vigencia y notas"} <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-2 space-y-2">
            {!full && (
              <div className="space-y-1">
                <Label htmlFor="qb-client">Preparado para</Label>
                <Input id="qb-client" value={client.name} onChange={(e) => setClient({ ...client, name: e.target.value })} placeholder="Nombre del cliente" />
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="qb-valid">Vigencia (días)</Label>
              <Input id="qb-valid" type="number" min={1} max={90} value={validDays ?? defaults.validDays} onChange={(e) => setValidDays(Number(e.target.value))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="qb-notes">Notas</Label>
              <Textarea id="qb-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="p. ej. incluye verificación vigente" />
            </div>
          </div>
        </details>
      </div>

      <div className={cn("flex items-center gap-2 border-t py-3", full ? "mt-4" : "px-4")}>
        {onCancel && (
          <Button variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
        )}
        <Button className="ml-auto" disabled={busy || !chosen.length || (withFinancing && !financing.terms.length)} onClick={generate}>
          <Link2 /> {busy ? "Generando…" : actionLabel}
        </Button>
      </div>
    </div>
  );
}

function Thumb({ v }: { v: Vehicle }) {
  return v.photos[0] ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={v.photos[0].url} alt="" className="size-11 shrink-0 rounded object-cover" />
  ) : (
    <span className="flex size-11 shrink-0 items-center justify-center rounded bg-muted">
      <Car className="size-4 text-muted-foreground" />
    </span>
  );
}
