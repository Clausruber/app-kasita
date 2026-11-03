"use client";

import { useState, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, addDays } from "date-fns";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { DEAL_STAGES, GUARDED_STAGES, PAYMENT_METHODS, money } from "@/lib/vehicle-catalog";
import type { Client, Deal, DealStage } from "@/lib/types";
import { useCan } from "@/hooks/use-me";
import { useDeals, usePutDeal } from "@/hooks/use-deals";
import { useVehicles } from "@/hooks/use-vehicles";
import { HoldWarning } from "@/components/inventory/hold-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const selectCls = "h-8 w-full rounded-lg border bg-background px-2 text-sm";
const clientName = (c: Client) => [c.firstName, c.lastName].filter(Boolean).join(" ") || c.displayName || "Sin nombre";

function useClientsIfAllowed() {
  const { user } = useAuth();
  const can = useCan();
  return useQuery({ queryKey: ["clients"], enabled: !!user && can("clients"), queryFn: () => api<{ clients: Client[] }>("/api/clients") });
}

type DealForm = {
  clientId: string;
  clientName: string;
  clientPhone: string;
  vehicleId: string;
  stage: DealStage;
  assigneeId: string;
  value: string;
  notes: string;
  lostReason: string;
};

/**
 * Create or edit an opportunity. `prefill` links it to a client or vehicle when opened from their pages.
 * `trigger` is the button that opens it; without one the dialog is controlled by `open`.
 */
export function DealDialog({
  deal,
  prefill,
  trigger,
  open: openProp,
  onOpenChange,
}: {
  deal?: Deal;
  prefill?: { clientId?: string; vehicleId?: string };
  trigger?: ReactElement;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
}) {
  const can = useCan();
  const putDeal = usePutDeal();
  const board = useDeals();
  const clients = useClientsIfAllowed();
  const vehicles = useVehicles();
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = onOpenChange ?? setOpenState;
  const [saving, setSaving] = useState(false);
  const blank = (): DealForm => ({
    clientId: deal?.clientId ?? prefill?.clientId ?? "",
    clientName: deal?.clientName ?? "",
    clientPhone: deal?.clientPhone ?? "",
    vehicleId: deal?.vehicleId ?? prefill?.vehicleId ?? "",
    stage: deal?.stage ?? "nuevo",
    assigneeId: deal?.assigneeId ?? board.data?.me ?? "",
    value: deal?.value != null ? String(deal.value) : "",
    notes: deal?.notes ?? "",
    lostReason: deal?.lostReason ?? "",
  });
  const [form, setForm] = useState<DealForm>(blank);
  const set = <K extends keyof DealForm>(k: K, v: DealForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const locked = !!deal && GUARDED_STAGES.includes(deal.stage);
  const forSale = (vehicles.data?.vehicles ?? []).filter((v) => v.status !== "vendido" || v.id === form.vehicleId);

  async function save() {
    setSaving(true);
    try {
      const body = {
        ...(form.clientId ? { clientId: form.clientId } : { clientId: "", clientName: form.clientName, clientPhone: form.clientPhone }),
        vehicleId: form.vehicleId,
        ...(locked ? {} : { stage: form.stage }),
        ...(can("deals.assignAll") ? { assigneeId: form.assigneeId || null } : {}),
        value: form.value,
        notes: form.notes,
        lostReason: form.lostReason,
      };
      const r = deal
        ? await api<{ deal: Deal }>(`/api/deals/${deal.id}`, { method: "PATCH", body })
        : await api<{ deal: Deal }>("/api/deals", { method: "POST", body });
      putDeal(r.deal);
      toast.success(deal ? "Oportunidad guardada" : "Oportunidad creada");
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
        if (o) setForm(blank());
        setOpen(o);
      }}
    >
      {trigger && <DialogTrigger render={trigger} />}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{deal ? "Oportunidad" : "Nueva oportunidad"}</DialogTitle>
          <DialogDescription>Un cliente interesado en un auto, de la primera conversación hasta la venta.</DialogDescription>
        </DialogHeader>
        <fieldset disabled={!can("deals.edit")} className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="d-client">Cliente</Label>
            {clients.data ? (
              <select id="d-client" className={selectCls} value={form.clientId} onChange={(e) => set("clientId", e.target.value)}>
                <option value="">— Escribir a mano —</option>
                {clients.data.clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {clientName(c)}
                    {c.whatsapp ? ` · ${c.whatsapp}` : ""}
                  </option>
                ))}
              </select>
            ) : null}
            {!form.clientId && (
              <div className="flex gap-2">
                <Input aria-label="Nombre del cliente" placeholder="Nombre" value={form.clientName} onChange={(e) => set("clientName", e.target.value)} />
                <Input aria-label="Teléfono" placeholder="WhatsApp" value={form.clientPhone} onChange={(e) => set("clientPhone", e.target.value)} />
              </div>
            )}
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="d-vehicle">Auto de interés</Label>
            <select id="d-vehicle" className={selectCls} value={form.vehicleId} disabled={locked} onChange={(e) => set("vehicleId", e.target.value)}>
              <option value="">— Sin auto todavía —</option>
              {forSale.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.title} · {money(v.price)} {v.status !== "disponible" ? `(${v.status})` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="d-stage">Etapa</Label>
            <select id="d-stage" className={selectCls} value={form.stage} disabled={locked} onChange={(e) => set("stage", e.target.value as DealStage)}>
              {DEAL_STAGES.filter((s) => !GUARDED_STAGES.includes(s.id) || s.id === form.stage).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="d-value">Valor estimado (MXN)</Label>
            <Input id="d-value" type="number" inputMode="numeric" value={form.value} onChange={(e) => set("value", e.target.value)} />
          </div>
          {can("deals.assignAll") && (
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="d-seller">Vendedor</Label>
              <select id="d-seller" className={selectCls} value={form.assigneeId} onChange={(e) => set("assigneeId", e.target.value)}>
                <option value="">Sin asignar</option>
                {board.data?.sellers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {form.stage === "perdido" && (
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="d-lost">Motivo de pérdida</Label>
              <Input id="d-lost" placeholder="Precio, compró en otro lado, no calificó a crédito…" value={form.lostReason} onChange={(e) => set("lostReason", e.target.value)} />
            </div>
          )}
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="d-notes">Notas</Label>
            <Textarea id="d-notes" rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
        </fieldset>
        {can("deals.edit") && (
          <DialogFooter>
            <Button disabled={saving} onClick={save}>
              {saving ? "Guardando…" : deal ? "Guardar" : "Crear oportunidad"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Apartado: down payment and expiry; the vehicle stops being offered while it lasts. */
/** "Bloqueado por Laura…" when the deal's car is held by someone else (inventory cache; blocks nothing). */
function VehicleHoldWarning({ vehicleId }: { vehicleId: string | null }) {
  const hold = useVehicles(!!vehicleId).data?.vehicles.find((v) => v.id === vehicleId)?.hold;
  return <HoldWarning hold={hold} />;
}

export function ReserveDialog({ deal, open, onOpenChange }: { deal: Deal; open: boolean; onOpenChange: (o: boolean) => void }) {
  const putDeal = usePutDeal();
  const [amount, setAmount] = useState("");
  const [expires, setExpires] = useState(() => format(addDays(new Date(), 7), "yyyy-MM-dd"));
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const r = await api<{ deal: Deal }>(`/api/deals/${deal.id}/reserve`, {
        method: "POST",
        body: { amount: Number(amount) || 0, expiresAt: new Date(`${expires}T23:59:00`).toISOString() },
      });
      putDeal(r.deal, { vehicleChanged: true });
      toast.success("Auto apartado");
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Apartar {deal.vehicleTitle ?? "auto"}</DialogTitle>
          <DialogDescription>Para {deal.clientName}. El auto deja de ofrecerse (y el agente IA ya no lo muestra) hasta que se venda o se libere.</DialogDescription>
        </DialogHeader>
        <VehicleHoldWarning vehicleId={deal.vehicleId} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="r-amount">Anticipo (MXN)</Label>
            <Input id="r-amount" type="number" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="r-exp">Vence el</Label>
            <Input id="r-exp" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={busy || !deal.vehicleId} onClick={submit}>
            {busy ? "Apartando…" : "Confirmar apartado"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Venta: final price, salesperson and payment method; marks the vehicle sold. */
export function SaleDialog({ deal, open, onOpenChange }: { deal: Deal; open: boolean; onOpenChange: (o: boolean) => void }) {
  const putDeal = usePutDeal();
  const board = useDeals();
  const [price, setPrice] = useState(() => (deal.value ? String(deal.value) : ""));
  const [seller, setSeller] = useState(() => deal.assigneeId ?? board.data?.me ?? "");
  const [payment, setPayment] = useState<string>("contado");
  const [financier, setFinancier] = useState("");
  const [down, setDown] = useState("");
  const [soldAt, setSoldAt] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const r = await api<{ deal: Deal }>(`/api/deals/${deal.id}/sell`, {
        method: "POST",
        body: { finalPrice: Number(price), sellerId: seller, paymentMethod: payment, financier, downPayment: down, soldAt: new Date(`${soldAt}T12:00:00`).toISOString() },
      });
      putDeal(r.deal, { vehicleChanged: true });
      toast.success("¡Venta registrada!");
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar venta</DialogTitle>
          <DialogDescription>
            {deal.vehicleTitle ?? "Auto"} a {deal.clientName}. Las demás oportunidades de este auto se cierran como perdidas.
          </DialogDescription>
        </DialogHeader>
        <VehicleHoldWarning vehicleId={deal.vehicleId} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="s-price">Precio final (MXN)</Label>
            <Input id="s-price" type="number" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="s-date">Fecha de venta</Label>
            <Input id="s-date" type="date" value={soldAt} onChange={(e) => setSoldAt(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="s-pay">Forma de pago</Label>
            <select id="s-pay" className={selectCls} value={payment} onChange={(e) => setPayment(e.target.value)}>
              {PAYMENT_METHODS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="s-down">Enganche (opcional)</Label>
            <Input id="s-down" type="number" inputMode="numeric" value={down} onChange={(e) => setDown(e.target.value)} />
          </div>
          {payment === "financiera" && (
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="s-fin">Financiera / banco</Label>
              <Input id="s-fin" value={financier} onChange={(e) => setFinancier(e.target.value)} />
            </div>
          )}
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="s-seller">Vendedor</Label>
            <select id="s-seller" className={selectCls} value={seller} onChange={(e) => setSeller(e.target.value)}>
              {board.data?.sellers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button disabled={busy || !Number(price) || !deal.vehicleId} onClick={submit}>
            {busy ? "Registrando…" : `Registrar venta${Number(price) ? ` por ${money(Number(price))}` : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Small helper for pages that only need "create a deal for this client / vehicle". */
export function NewDealButton({ prefill, label = "Crear oportunidad" }: { prefill: { clientId?: string; vehicleId?: string }; label?: string }) {
  const can = useCan();
  if (!can("deals") || !can("deals.edit")) return null;
  return <DealDialog prefill={prefill} trigger={<Button variant="outline" size="sm">{label}</Button>} />;
}

