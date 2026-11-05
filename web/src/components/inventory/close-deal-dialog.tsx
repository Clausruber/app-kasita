"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { BadgeDollarSign, KeyRound, X } from "lucide-react";
import { api } from "@/lib/api";
import { CLOSE_KINDS, LEASE_MONTHS, PAYMENT_METHODS, forRent, forSale, money } from "@/lib/property-catalog";
import type { Client, CloseKind, Deal, Operation, Property } from "@/lib/types";
import { useCan, useMe } from "@/hooks/use-me";
import { useDeals } from "@/hooks/use-deals";
import { usePutPropertyCache } from "@/hooks/use-properties";
import { HoldWarning } from "@/components/inventory/hold-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const selectCls = "h-8 w-full rounded-lg border bg-background px-2 text-sm";
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const nameOf = (c: Client) => [c.firstName, c.lastName].filter(Boolean).join(" ") || c.displayName;
const today = () => format(new Date(), "yyyy-MM-dd");

type PriceSource = Pick<Property, "operation" | "salePrice" | "rentPrice"> | null | undefined;

/**
 * Terms of a closing, shared by Propiedades and the pipeline: a sale (final price, payment, down payment)
 * or a rental (monthly rent, deposit, lease length and start). `body` is what the close endpoints take.
 */
export function useCloseTerms(property: PriceSource, sellerDefault: string) {
  const operation: Operation = property?.operation ?? "venta";
  const [kind, setKind] = useState<CloseKind>(forSale(operation) ? "venta" : "renta");
  const [price, setPrice] = useState(String(property?.salePrice ?? ""));
  const [payment, setPayment] = useState("contado");
  const [financier, setFinancier] = useState("");
  const [down, setDown] = useState("");
  const [rent, setRent] = useState(String(property?.rentPrice ?? ""));
  const [deposit, setDeposit] = useState(String(property?.rentPrice ?? ""));
  const [months, setMonths] = useState("12");
  const [date, setDate] = useState(today);
  const [seller, setSeller] = useState(sellerDefault);
  const amount = Number(kind === "venta" ? price : rent);
  const body = {
    kind,
    sellerId: seller,
    closedAt: new Date(`${date}T12:00:00`).toISOString(),
    ...(kind === "venta"
      ? { finalPrice: Number(price), paymentMethod: payment, financier, downPayment: down }
      : { monthlyRent: Number(rent), deposit: Number(deposit) || 0, months: Number(months), leaseStart: new Date(`${date}T12:00:00`).toISOString() }),
  };
  const label = kind === "venta" ? `Vender${amount ? ` por ${money(amount)}` : ""}` : `Rentar${amount ? ` por ${money(amount)}/mes` : ""}`;
  return {
    operation, kind, setKind, price, setPrice, payment, setPayment, financier, setFinancier, down, setDown,
    rent, setRent, deposit, setDeposit, months, setMonths, date, setDate, seller, setSeller, amount, body, label,
  };
}
export type CloseTerms = ReturnType<typeof useCloseTerms>;

export function CloseTermsFields({ t, property, sellers }: { t: CloseTerms; property: PriceSource; sellers: { id: string; name: string }[] }) {
  const kinds = CLOSE_KINDS.filter((k) => (k.id === "venta" ? forSale(t.operation) : forRent(t.operation)));
  return (
    <div className="space-y-3">
      {kinds.length > 1 && (
        <div className="grid grid-cols-2 rounded-lg bg-muted p-1">
          {kinds.map((k) => (
            <button
              key={k.id}
              type="button"
              onClick={() => t.setKind(k.id)}
              className={cn(
                "rounded-md py-1.5 text-sm font-medium transition-colors",
                t.kind === k.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {k.label}
            </button>
          ))}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {t.kind === "venta" ? (
          <>
            <div className="space-y-1">
              <Label htmlFor="ct-price">Precio final (MXN)</Label>
              <Input id="ct-price" type="number" inputMode="numeric" value={t.price} onChange={(e) => t.setPrice(e.target.value)} />
              {property?.salePrice != null && Number(t.price) > 0 && Number(t.price) !== property.salePrice && (
                <p className="text-[11px] text-muted-foreground">Precio de lista {money(property.salePrice)}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="ct-date">Fecha de venta</Label>
              <Input id="ct-date" type="date" value={t.date} onChange={(e) => t.setDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ct-pay">Forma de pago</Label>
              <select id="ct-pay" className={selectCls} value={t.payment} onChange={(e) => t.setPayment(e.target.value)}>
                {PAYMENT_METHODS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ct-down">Enganche (opcional)</Label>
              <Input id="ct-down" type="number" inputMode="numeric" value={t.down} onChange={(e) => t.setDown(e.target.value)} />
            </div>
            {t.payment !== "contado" && (
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="ct-fin">Banco / institución</Label>
                <Input id="ct-fin" value={t.financier} onChange={(e) => t.setFinancier(e.target.value)} />
              </div>
            )}
          </>
        ) : (
          <>
            <div className="space-y-1">
              <Label htmlFor="ct-rent">Renta mensual (MXN)</Label>
              <Input id="ct-rent" type="number" inputMode="numeric" value={t.rent} onChange={(e) => t.setRent(e.target.value)} />
              {property?.rentPrice != null && Number(t.rent) > 0 && Number(t.rent) !== property.rentPrice && (
                <p className="text-[11px] text-muted-foreground">Renta publicada {money(property.rentPrice)}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="ct-dep">Depósito</Label>
              <Input id="ct-dep" type="number" inputMode="numeric" value={t.deposit} onChange={(e) => t.setDeposit(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ct-months">Plazo del contrato</Label>
              <select id="ct-months" className={selectCls} value={t.months} onChange={(e) => t.setMonths(e.target.value)}>
                {LEASE_MONTHS.map((m) => (
                  <option key={m} value={m}>
                    {m} meses
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ct-date">Inicio del contrato</Label>
              <Input id="ct-date" type="date" value={t.date} onChange={(e) => t.setDate(e.target.value)} />
            </div>
          </>
        )}
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="ct-seller">Asesor</Label>
          <select id="ct-seller" className={selectCls} value={t.seller} onChange={(e) => t.setSeller(e.target.value)}>
            {sellers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

/** "Cerrar" button for a property (Propiedades card and sheet): sale or rental. */
export function CloseButton({ property, size = "sm" }: { property: Property; size?: "sm" | "xs" }) {
  const can = useCan();
  const [open, setOpen] = useState(false);
  if (!can("deals.sell") || !["disponible", "apartado"].includes(property.status)) return null;
  return (
    <>
      <Button size={size} onClick={() => setOpen(true)}>
        <BadgeDollarSign /> Cerrar
      </Button>
      {open && <CloseDealDialog property={property} onClose={() => setOpen(false)} />}
    </>
  );
}

/** "Volver a disponible" for a rented property whose lease ended. */
export function RelistButton({ property, size = "sm" }: { property: Property; size?: "sm" | "xs" }) {
  const can = useCan();
  const putCache = usePutPropertyCache();
  const [busy, setBusy] = useState(false);
  if (!can("inventory.edit") || property.status !== "rentado") return null;
  async function relist() {
    if (!confirm("¿El contrato terminó? La propiedad vuelve a Disponible.")) return;
    setBusy(true);
    try {
      putCache((await api<{ property: Property }>(`/api/properties/${property.id}/relist`, { method: "POST" })).property);
      toast.success("La propiedad está disponible de nuevo");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button size={size} variant="outline" disabled={busy} onClick={relist}>
      <KeyRound /> Volver a disponible
    </Button>
  );
}

/**
 * Closing from Propiedades: client (search or new) plus the sale or rental terms. The server closes the
 * reservation's deal, an open one of that client, or opens one, with the same transaction as the pipeline.
 */
function CloseDealDialog({ property, onClose }: { property: Property; onClose: () => void }) {
  const qc = useQueryClient();
  const putCache = usePutPropertyCache();
  const can = useCan();
  const me = useMe().data?.sellerId ?? "";
  const board = useDeals();
  const clients = useQuery({ queryKey: ["clients"], enabled: can("clients"), queryFn: () => api<{ clients: Client[] }>("/api/clients") });
  const reservedDeal: Deal | undefined = property.reservation ? board.data?.deals.find((d) => d.id === property.reservation!.dealId) : undefined;
  const [client, setClient] = useState<{ id: string | null; name: string; whatsapp: string }>({ id: null, name: "", whatsapp: "" });
  const [query, setQuery] = useState("");
  // Default agent: whoever is showing the property, else the signed-in user.
  const t = useCloseTerms(property, property.hold?.byId || me);
  const [busy, setBusy] = useState(false);

  const matches = useMemo(() => {
    const term = norm(query.trim());
    if (!term) return [];
    return (clients.data?.clients ?? []).filter((c) => norm([nameOf(c), c.username, c.whatsapp].join(" ")).includes(term)).slice(0, 6);
  }, [clients.data, query]);
  const reserved = !!property.reservation;
  const hasClient = reserved || !!client.id || !!client.name.trim();

  async function submit() {
    setBusy(true);
    try {
      const r = await api<{ property: Property; deal: Deal }>(`/api/properties/${property.id}/close`, {
        method: "POST",
        body: {
          ...(reserved ? {} : client.id ? { clientId: client.id } : { clientName: client.name.trim(), clientWhatsapp: client.whatsapp.trim() }),
          ...t.body,
          sellerId: t.seller || me,
        },
      });
      putCache(r.property);
      qc.invalidateQueries({ queryKey: ["deals"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.success(t.kind === "venta" ? `¡Venta registrada! ${property.title}` : `¡Renta registrada! ${property.title}`);
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cerrar {property.title || property.propertyType}</DialogTitle>
          <DialogDescription>
            La propiedad pasa a {t.kind === "venta" ? "Vendido" : "Rentado"} y las demás oportunidades de esta propiedad se cierran.
          </DialogDescription>
        </DialogHeader>
        <HoldWarning hold={property.hold} />

        <div className="space-y-1">
          <Label>Cliente</Label>
          {reserved ? (
            <p className="rounded-lg bg-muted px-3 py-2 text-sm">
              Apartado por <strong>{reservedDeal?.clientName ?? "su cliente"}</strong> · anticipo {money(property.reservation!.amount)}
            </p>
          ) : client.id ? (
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
            <div className="space-y-2">
              {can("clients") && (
                <div className="relative">
                  <Input placeholder="Buscar cliente por nombre o WhatsApp…" value={query} onChange={(e) => setQuery(e.target.value)} />
                  {matches.length > 0 && (
                    <ul className="absolute inset-x-0 top-9 z-10 rounded-lg border bg-popover p-1 shadow-md">
                      {matches.map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                            onClick={() => (setClient({ id: c.id, name: nameOf(c), whatsapp: c.whatsapp }), setQuery(""))}
                          >
                            {nameOf(c)} <span className="text-xs text-muted-foreground">· {c.whatsapp || c.username || c.platform}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                <Input placeholder={can("clients") ? "…o nombre del cliente nuevo" : "Nombre del cliente"} value={client.name} onChange={(e) => setClient({ ...client, name: e.target.value })} />
                <Input type="tel" placeholder="WhatsApp" value={client.whatsapp} onChange={(e) => setClient({ ...client, whatsapp: e.target.value })} />
              </div>
            </div>
          )}
        </div>

        <CloseTermsFields t={t} property={property} sellers={board.data?.sellers ?? []} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={busy || !t.amount || !hasClient} onClick={submit}>
            <BadgeDollarSign /> {busy ? "Registrando…" : t.label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
