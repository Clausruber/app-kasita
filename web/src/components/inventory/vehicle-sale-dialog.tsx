"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { BadgeDollarSign, X } from "lucide-react";
import { api } from "@/lib/api";
import { PAYMENT_METHODS, money } from "@/lib/vehicle-catalog";
import type { Client, Deal, Vehicle } from "@/lib/types";
import { useCan, useMe } from "@/hooks/use-me";
import { useDeals } from "@/hooks/use-deals";
import { usePutVehicleCache } from "@/hooks/use-vehicles";
import { HoldWarning } from "@/components/inventory/hold-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const selectCls = "h-8 w-full rounded-lg border bg-background px-2 text-sm";
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const nameOf = (c: Client) => [c.firstName, c.lastName].filter(Boolean).join(" ") || c.displayName;

/** "Vender" button for a car (inventory card and sheet). */
export function SellButton({ vehicle, size = "sm" }: { vehicle: Vehicle; size?: "sm" | "xs" }) {
  const can = useCan();
  const [open, setOpen] = useState(false);
  if (!can("deals.sell") || vehicle.status === "vendido" || vehicle.status === "borrador") return null;
  return (
    <>
      <Button size={size} onClick={() => setOpen(true)}>
        <BadgeDollarSign /> Vender
      </Button>
      {open && <VehicleSaleDialog vehicle={vehicle} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * Sale from the inventory: client (search or new), final price, seller, payment. The server closes the
 * reservation's deal, an open one of that client, or opens one, with the same sale transaction as the pipeline.
 */
function VehicleSaleDialog({ vehicle, onClose }: { vehicle: Vehicle; onClose: () => void }) {
  const qc = useQueryClient();
  const putCache = usePutVehicleCache();
  const can = useCan();
  const me = useMe().data?.sellerId ?? "";
  const board = useDeals();
  const clients = useQuery({ queryKey: ["clients"], enabled: can("clients"), queryFn: () => api<{ clients: Client[] }>("/api/clients") });
  const reservedDeal: Deal | undefined = vehicle.reservation ? board.data?.deals.find((d) => d.id === vehicle.reservation!.dealId) : undefined;
  const [client, setClient] = useState<{ id: string | null; name: string; whatsapp: string }>({ id: null, name: "", whatsapp: "" });
  const [query, setQuery] = useState("");
  // Default seller: whoever is holding the car, else the signed-in user.
  const [seller, setSeller] = useState(vehicle.hold?.byId || me);
  const [price, setPrice] = useState(String(vehicle.price || ""));
  const [payment, setPayment] = useState("contado");
  const [financier, setFinancier] = useState("");
  const [down, setDown] = useState("");
  const [soldAt, setSoldAt] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [busy, setBusy] = useState(false);

  const matches = useMemo(() => {
    const term = norm(query.trim());
    if (!term) return [];
    return (clients.data?.clients ?? []).filter((c) => norm([nameOf(c), c.username, c.whatsapp].join(" ")).includes(term)).slice(0, 6);
  }, [clients.data, query]);
  const reserved = !!vehicle.reservation;
  const hasClient = reserved || !!client.id || !!client.name.trim();

  async function submit() {
    setBusy(true);
    try {
      const r = await api<{ vehicle: Vehicle; deal: Deal }>(`/api/vehicles/${vehicle.id}/sell`, {
        method: "POST",
        body: {
          ...(reserved ? {} : client.id ? { clientId: client.id } : { clientName: client.name.trim(), clientWhatsapp: client.whatsapp.trim() }),
          finalPrice: Number(price),
          sellerId: seller || me,
          paymentMethod: payment,
          financier,
          downPayment: down,
          soldAt: new Date(`${soldAt}T12:00:00`).toISOString(),
        },
      });
      putCache(r.vehicle);
      qc.invalidateQueries({ queryKey: ["deals"] });
      toast.success(`¡Venta registrada! ${vehicle.title} por ${money(Number(price))}`);
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
          <DialogTitle>Vender {vehicle.title || `${vehicle.brand} ${vehicle.model}`}</DialogTitle>
          <DialogDescription>Se registra la venta, el auto pasa a Vendido y las demás oportunidades de este auto se cierran.</DialogDescription>
        </DialogHeader>
        <HoldWarning hold={vehicle.hold} />

        <div className="space-y-1">
          <Label>Cliente</Label>
          {reserved ? (
            <p className="rounded-lg bg-muted px-3 py-2 text-sm">
              Apartado por <strong>{reservedDeal?.clientName ?? "su cliente"}</strong> · anticipo {money(vehicle.reservation!.amount)}
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

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="vs-price">Precio final (MXN)</Label>
            <Input id="vs-price" type="number" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
            {Number(price) > 0 && Number(price) !== vehicle.price && <p className="text-[11px] text-muted-foreground">Precio de lista {money(vehicle.price)}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="vs-date">Fecha de venta</Label>
            <Input id="vs-date" type="date" value={soldAt} onChange={(e) => setSoldAt(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="vs-pay">Forma de pago</Label>
            <select id="vs-pay" className={selectCls} value={payment} onChange={(e) => setPayment(e.target.value)}>
              {PAYMENT_METHODS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="vs-down">Enganche (opcional)</Label>
            <Input id="vs-down" type="number" inputMode="numeric" value={down} onChange={(e) => setDown(e.target.value)} />
          </div>
          {payment === "financiera" && (
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="vs-fin">Financiera / banco</Label>
              <Input id="vs-fin" value={financier} onChange={(e) => setFinancier(e.target.value)} />
            </div>
          )}
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="vs-seller">Vendedor</Label>
            <select id="vs-seller" className={selectCls} value={seller} onChange={(e) => setSeller(e.target.value)}>
              {(board.data?.sellers ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={busy || !Number(price) || !hasClient} onClick={submit}>
            <BadgeDollarSign /> {busy ? "Registrando…" : `Vender${Number(price) ? ` por ${money(Number(price))}` : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
