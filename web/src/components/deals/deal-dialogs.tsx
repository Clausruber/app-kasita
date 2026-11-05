"use client";

import { useState, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, addDays } from "date-fns";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { DEAL_STAGES, GUARDED_STAGES, priceLine } from "@/lib/property-catalog";
import type { Client, Deal, DealStage, Property } from "@/lib/types";
import { useCan } from "@/hooks/use-me";
import { useDeals, usePutDeal } from "@/hooks/use-deals";
import { useProperties } from "@/hooks/use-properties";
import { HoldWarning } from "@/components/inventory/hold-dialog";
import { CloseTermsFields, useCloseTerms } from "@/components/inventory/close-deal-dialog";
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
  propertyId: string;
  stage: DealStage;
  assigneeId: string;
  value: string;
  notes: string;
  lostReason: string;
};

/**
 * Create or edit an opportunity. `prefill` links it to a client or property when opened from their pages.
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
  prefill?: { clientId?: string; propertyId?: string };
  trigger?: ReactElement;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
}) {
  const can = useCan();
  const putDeal = usePutDeal();
  const board = useDeals();
  const clients = useClientsIfAllowed();
  const properties = useProperties();
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = onOpenChange ?? setOpenState;
  const [saving, setSaving] = useState(false);
  const blank = (): DealForm => ({
    clientId: deal?.clientId ?? prefill?.clientId ?? "",
    clientName: deal?.clientName ?? "",
    clientPhone: deal?.clientPhone ?? "",
    propertyId: deal?.propertyId ?? prefill?.propertyId ?? "",
    stage: deal?.stage ?? "nuevo",
    assigneeId: deal?.assigneeId ?? board.data?.me ?? "",
    value: deal?.value != null ? String(deal.value) : "",
    notes: deal?.notes ?? "",
    lostReason: deal?.lostReason ?? "",
  });
  const [form, setForm] = useState<DealForm>(blank);
  const set = <K extends keyof DealForm>(k: K, v: DealForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const locked = !!deal && GUARDED_STAGES.includes(deal.stage);
  const offered = (properties.data?.properties ?? []).filter((v) => !["vendido", "rentado"].includes(v.status) || v.id === form.propertyId);

  async function save() {
    setSaving(true);
    try {
      const body = {
        ...(form.clientId ? { clientId: form.clientId } : { clientId: "", clientName: form.clientName, clientPhone: form.clientPhone }),
        propertyId: form.propertyId,
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
          <DialogDescription>Un cliente interesado en una propiedad, de la primera conversación hasta el cierre.</DialogDescription>
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
            <Label htmlFor="d-property">Propiedad de interés</Label>
            <select id="d-property" className={selectCls} value={form.propertyId} disabled={locked} onChange={(e) => set("propertyId", e.target.value)}>
              <option value="">— Sin propiedad todavía —</option>
              {offered.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.title} · {priceLine(v)} {v.status !== "disponible" ? `(${v.status})` : ""}
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
              <Label htmlFor="d-seller">Asesor</Label>
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
              <Input id="d-lost" placeholder="Precio, eligió otra propiedad, no calificó a crédito…" value={form.lostReason} onChange={(e) => set("lostReason", e.target.value)} />
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

/** Apartado: down payment and expiry; the property stops being offered while it lasts. */
/** "Bloqueado por Laura…" when the deal's property is held by someone else (inventory cache; blocks nothing). */
function PropertyHoldWarning({ propertyId }: { propertyId: string | null }) {
  const hold = useProperties(!!propertyId).data?.properties.find((v) => v.id === propertyId)?.hold;
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
      putDeal(r.deal, { propertyChanged: true });
      toast.success("Propiedad apartada");
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
          <DialogTitle>Apartar {deal.propertyTitle ?? "propiedad"}</DialogTitle>
          <DialogDescription>Para {deal.clientName}. La propiedad deja de ofrecerse (y el agente IA ya no la muestra) hasta que se cierre o se libere.</DialogDescription>
        </DialogHeader>
        <PropertyHoldWarning propertyId={deal.propertyId} />
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
          <Button disabled={busy || !deal.propertyId} onClick={submit}>
            {busy ? "Apartando…" : "Confirmar apartado"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Cierre: sale or rental terms; marks the property vendido or rentado. */
export function SaleDialog({ deal, open, onOpenChange }: { deal: Deal; open: boolean; onOpenChange: (o: boolean) => void }) {
  const properties = useProperties(!!deal.propertyId);
  const property = properties.data?.properties.find((v) => v.id === deal.propertyId) ?? null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cerrar operación</DialogTitle>
          <DialogDescription>
            {deal.propertyTitle ?? "Propiedad"} con {deal.clientName}. Las demás oportunidades de esta propiedad se cierran como perdidas.
          </DialogDescription>
        </DialogHeader>
        <PropertyHoldWarning propertyId={deal.propertyId} />
        {!deal.propertyId ? (
          <p className="text-sm text-muted-foreground">Asigna una propiedad a la oportunidad antes de cerrarla.</p>
        ) : property ? (
          <SaleForm deal={deal} property={property} onDone={() => onOpenChange(false)} />
        ) : (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SaleForm({ deal, property, onDone }: { deal: Deal; property: Property; onDone: () => void }) {
  const putDeal = usePutDeal();
  const board = useDeals();
  const t = useCloseTerms(property, deal.assigneeId ?? board.data?.me ?? "");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const r = await api<{ deal: Deal }>(`/api/deals/${deal.id}/close`, { method: "POST", body: t.body });
      putDeal(r.deal, { propertyChanged: true });
      toast.success(t.kind === "venta" ? "¡Venta registrada!" : "¡Renta registrada!");
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <CloseTermsFields t={t} property={property} sellers={board.data?.sellers ?? []} />
      <DialogFooter>
        <Button disabled={busy || !t.amount} onClick={submit}>
          {busy ? "Registrando…" : t.label}
        </Button>
      </DialogFooter>
    </>
  );
}

/** Small helper for pages that only need "create a deal for this client / property". */
export function NewDealButton({ prefill, label = "Crear oportunidad" }: { prefill: { clientId?: string; propertyId?: string }; label?: string }) {
  const can = useCan();
  if (!can("deals") || !can("deals.edit")) return null;
  return <DealDialog prefill={prefill} trigger={<Button variant="outline" size="sm">{label}</Button>} />;
}

