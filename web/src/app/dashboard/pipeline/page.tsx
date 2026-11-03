"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";
import { Car, Lock, MoreHorizontal, Phone, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { DEAL_STAGES, GUARDED_STAGES, money } from "@/lib/vehicle-catalog";
import type { Deal, DealStage } from "@/lib/types";
import { useCan } from "@/hooks/use-me";
import { type DealsData, useDeals, usePutDeal } from "@/hooks/use-deals";
import { DealDialog, ReserveDialog, SaleDialog } from "@/components/deals/deal-dialogs";
import { CatalogDrawer } from "@/components/quotes/catalog-drawer";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type Modal = { kind: "edit" | "reserve" | "sell" | "quote"; deal: Deal } | null;

function DealCard({ deal, seller, onOpen, onDragStart, menu }: { deal: Deal; seller?: string; onOpen: () => void; onDragStart: () => void; menu: React.ReactNode }) {
  const locked = GUARDED_STAGES.includes(deal.stage);
  return (
    <li
      draggable={deal.stage !== "vendido"}
      onDragStart={onDragStart}
      className="group cursor-grab rounded-lg border bg-background p-2 text-sm shadow-xs active:cursor-grabbing"
    >
      <div className="flex items-start gap-1">
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <p className="truncate font-medium">{deal.clientName || "Sin nombre"}</p>
          {deal.vehicleTitle && (
            <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
              <Car className="size-3 shrink-0" /> {deal.vehicleTitle}
            </p>
          )}
        </button>
        {menu}
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
        {deal.value != null && <span className="font-medium text-foreground">{money(deal.value)}</span>}
        {deal.clientPhone && (
          <a href={`https://wa.me/${deal.clientPhone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" aria-label="WhatsApp" className="hover:text-emerald-600">
            <Phone className="size-3" />
          </a>
        )}
        {locked && <Lock className="size-3" aria-label="Se cambia con Apartar / Registrar venta" />}
        <span className="ml-auto truncate">
          {seller ? `${seller} · ` : ""}
          {deal.stageChangedAt ? formatDistanceToNowStrict(new Date(deal.stageChangedAt), { locale: es }) : ""}
        </span>
      </div>
      {deal.stage === "perdido" && deal.lostReason && <p className="mt-1 truncate text-xs text-muted-foreground">Motivo: {deal.lostReason}</p>}
      {deal.reservation && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Anticipo {money(deal.reservation.amount)} · vence {new Date(deal.reservation.expiresAt).toLocaleDateString("es-MX")}</p>}
    </li>
  );
}

/** Pipeline: kanban of opportunities. Dragging to Apartado or Vendido opens the matching dialog. */
export default function PipelinePage() {
  const { data, isLoading, error } = useDeals();
  const can = useCan();
  const qc = useQueryClient();
  const putDeal = usePutDeal();
  const [modal, setModal] = useState<Modal>(null);
  const [creating, setCreating] = useState(false);
  const [dragging, setDragging] = useState<Deal | null>(null);
  const [overStage, setOverStage] = useState<DealStage | null>(null);
  const [seller, setSeller] = useState("all");
  const sellers = useMemo(() => new Map((data?.sellers ?? []).map((s) => [s.id, s.name])), [data]);
  const deals = useMemo(() => (data?.deals ?? []).filter((d) => seller === "all" || (seller === "none" ? !d.assigneeId : d.assigneeId === seller)), [data, seller]);

  async function moveTo(deal: Deal, stage: DealStage) {
    if (deal.stage === stage) return;
    if (stage === "apartado") return can("deals.reserve") ? setModal({ kind: "reserve", deal }) : toast.error("No tienes permiso para apartar");
    if (stage === "vendido") return can("deals.sell") ? setModal({ kind: "sell", deal }) : toast.error("No tienes permiso para registrar ventas");
    if (deal.stage === "apartado") return toast.error("Libera el apartado antes de mover esta oportunidad");
    if (stage === "perdido") return setModal({ kind: "edit", deal: { ...deal, stage: "perdido" } });
    const prev = qc.getQueryData<DealsData>(["deals"]);
    putDeal({ ...deal, stage, stageChangedAt: new Date().toISOString() }); // optimistic
    try {
      const r = await api<{ deal: Deal }>(`/api/deals/${deal.id}`, { method: "PATCH", body: { stage } });
      putDeal(r.deal);
    } catch (e) {
      qc.setQueryData(["deals"], prev);
      toast.error((e as Error).message);
    }
  }

  async function release(deal: Deal) {
    if (!confirm("¿Liberar el apartado? El auto vuelve a estar disponible.")) return;
    try {
      const r = await api<{ deal: Deal }>(`/api/deals/${deal.id}/release`, { method: "POST" });
      putDeal(r.deal, { vehicleChanged: true });
      toast.success("Apartado liberado");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function remove(deal: Deal) {
    if (!confirm(`¿Borrar la oportunidad de ${deal.clientName}?`)) return;
    try {
      await api(`/api/deals/${deal.id}`, { method: "DELETE" });
      qc.setQueryData<DealsData>(["deals"], (old) => old && { ...old, deals: old.deals.filter((d) => d.id !== deal.id) });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const menuFor = (deal: Deal) => (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label="Acciones" className="shrink-0" />}>
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setModal({ kind: "edit", deal })}>Ver / editar</DropdownMenuItem>
        {can("inventory") && <DropdownMenuItem onClick={() => setModal({ kind: "quote", deal })}>Cotizar (PDF)</DropdownMenuItem>}
        {!GUARDED_STAGES.includes(deal.stage) && can("deals.reserve") && deal.vehicleId && (
          <DropdownMenuItem onClick={() => setModal({ kind: "reserve", deal })}>Apartar auto</DropdownMenuItem>
        )}
        {deal.stage !== "vendido" && can("deals.sell") && deal.vehicleId && (
          <DropdownMenuItem onClick={() => setModal({ kind: "sell", deal })}>Registrar venta</DropdownMenuItem>
        )}
        {deal.stage === "apartado" && can("deals.void") && <DropdownMenuItem onClick={() => release(deal)}>Liberar apartado</DropdownMenuItem>}
        {!GUARDED_STAGES.includes(deal.stage) && can("deals.edit") && (
          <DropdownMenuItem variant="destructive" onClick={() => remove(deal)}>
            Borrar
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const open = deals.filter((d) => !["vendido", "perdido"].includes(d.stage));
  return (
    <div className="flex h-[calc(100dvh-7rem)] flex-col gap-3 md:h-[calc(100dvh-3rem)]">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-semibold">
          Pipeline{" "}
          {open.length > 0 && (
            <span className="text-base font-normal text-muted-foreground">
              · {open.length} abiertas · {money(open.reduce((n, d) => n + (d.value ?? 0), 0))}
            </span>
          )}
        </h1>
        {can("deals.assignAll") && (
          <select className="h-8 rounded-lg border bg-background px-2 text-sm" value={seller} onChange={(e) => setSeller(e.target.value)} aria-label="Filtrar por vendedor">
            <option value="all">Todos los vendedores</option>
            <option value="none">Sin asignar</option>
            {data?.sellers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        {can("deals.edit") && (
          <Button onClick={() => setCreating(true)}>
            <Plus /> Nueva oportunidad
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : (
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
          {DEAL_STAGES.map((s) => {
            const col = deals.filter((d) => d.stage === s.id);
            return (
              <section
                key={s.id}
                onDragOver={(e) => {
                  if (!dragging || !can("deals.edit")) return;
                  e.preventDefault();
                  setOverStage(s.id);
                }}
                onDragLeave={() => setOverStage(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setOverStage(null);
                  if (dragging) moveTo(dragging, s.id);
                  setDragging(null);
                }}
                className={cn("flex w-64 shrink-0 flex-col rounded-xl bg-muted/50", overStage === s.id && "ring-2 ring-primary")}
              >
                <h2 className="flex items-center gap-2 px-3 py-2 text-sm font-semibold">
                  {s.label}
                  <span className="text-xs font-normal text-muted-foreground">{col.length}</span>
                  {col.some((d) => d.value) && (
                    <span className="ml-auto text-xs font-normal text-muted-foreground">{money(col.reduce((n, d) => n + (d.value ?? 0), 0))}</span>
                  )}
                </h2>
                <ul className="min-h-16 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                  {col.map((d) => (
                    <DealCard
                      key={d.id}
                      deal={d}
                      seller={d.assigneeId ? sellers.get(d.assigneeId) : undefined}
                      onOpen={() => setModal({ kind: "edit", deal: d })}
                      onDragStart={() => setDragging(d)}
                      menu={menuFor(d)}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <DealDialog open={creating} onOpenChange={setCreating} />
      {modal?.kind === "edit" && <DealDialog deal={modal.deal} open onOpenChange={(o) => !o && setModal(null)} />}
      {modal?.kind === "reserve" && <ReserveDialog deal={modal.deal} open onOpenChange={(o) => !o && setModal(null)} />}
      {modal?.kind === "sell" && <SaleDialog deal={modal.deal} open onOpenChange={(o) => !o && setModal(null)} />}
      {modal?.kind === "quote" && (
        <CatalogDrawer
          open
          mode="share"
          onOpenChange={(o) => !o && setModal(null)}
          prefill={{ vehicleIds: modal.deal.vehicleId ? [modal.deal.vehicleId] : [], clientId: modal.deal.clientId, clientName: modal.deal.clientName, dealId: modal.deal.id }}
        />
      )}
    </div>
  );
}
