"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { daysOnLot, money } from "@/lib/vehicle-catalog";
import type { Vehicle } from "@/lib/types";
import { useCan } from "@/hooks/use-me";
import { usePutVehicleCache, useVehicle } from "@/hooks/use-vehicles";
import { NewDealButton } from "@/components/deals/deal-dialogs";
import { QuoteButton } from "@/components/quotes/catalog-drawer";
import { MlSheetDialog } from "@/components/inventory/ml-sheet-dialog";
import { PhotoManager } from "@/components/inventory/photo-manager";
import { PublishVehicleDialog } from "@/components/inventory/publish-vehicle-dialog";
import { StatusBadge } from "@/components/inventory/status-badge";
import { HoldBadge, HoldButtons, holdUntil } from "@/components/inventory/hold-dialog";
import { SellButton } from "@/components/inventory/vehicle-sale-dialog";
import { VehicleForm } from "@/components/inventory/vehicle-form";
import { Button } from "@/components/ui/button";

/** Vehicle sheet: data, photos and actions. `/dashboard/inventory/new` creates one. */
export default function VehiclePage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";
  const router = useRouter();
  const qc = useQueryClient();
  const can = useCan();
  const putCache = usePutVehicleCache();
  const { data, isLoading, error } = useVehicle(isNew ? null : id);
  const vehicle = data?.vehicle ?? null;

  async function remove(v: Vehicle) {
    if (!confirm(`¿Borrar ${v.title} y todas sus fotos? No se puede deshacer.`)) return;
    try {
      await api(`/api/vehicles/${v.id}`, { method: "DELETE" });
      qc.setQueryData<{ vehicles: Vehicle[] }>(["vehicles"], (old) => old && { vehicles: old.vehicles.filter((x) => x.id !== v.id) });
      toast.success("Auto borrado");
      router.replace("/dashboard/inventory");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (!isNew && isLoading) return <p className="text-sm text-muted-foreground">Cargando…</p>;
  if (!isNew && (error || !vehicle)) return <p className="text-sm text-destructive">{(error as Error)?.message ?? "Auto no encontrado"}</p>;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="icon-sm" aria-label="Volver al inventario" nativeButton={false} render={<Link href="/dashboard/inventory" />}>
          <ArrowLeft />
        </Button>
        <div className="mr-auto min-w-0">
          <h1 className="flex items-center gap-2 truncate text-xl font-semibold">
            {vehicle ? vehicle.title || `${vehicle.brand} ${vehicle.model}` : "Nuevo auto"}
            {vehicle && <StatusBadge status={vehicle.status} />}
          </h1>
          {vehicle && (
            <p className="text-sm text-muted-foreground">
              {money(vehicle.price)} · {daysOnLot(vehicle.intakeDate, vehicle.soldAt)} días en lote
              {vehicle.reservation && ` · apartado con ${money(vehicle.reservation.amount)}`}
            </p>
          )}
        </div>
        {vehicle && (
          <div className="flex flex-wrap gap-2">
            {vehicle.status !== "vendido" && <NewDealButton prefill={{ vehicleId: vehicle.id }} />}
            {vehicle.status !== "vendido" && vehicle.status !== "borrador" && <QuoteButton prefill={{ vehicleIds: [vehicle.id] }} />}
            <HoldButtons vehicle={vehicle} />
            <SellButton vehicle={vehicle} />
            {can("posts.create") && <PublishVehicleDialog vehicle={vehicle} />}
            <MlSheetDialog vehicle={vehicle} />
            {can("inventory.delete") && vehicle.status !== "vendido" && (
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => remove(vehicle)}>
                <Trash2 /> Borrar
              </Button>
            )}
          </div>
        )}
      </div>

      {vehicle?.hold && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          <HoldBadge hold={vehicle.hold} />
          <span>
            Bloqueado por <strong>{vehicle.hold.byName || "un vendedor"}</strong> {holdUntil(vehicle.hold.until)}
            {vehicle.hold.note && <span className="text-muted-foreground"> · {vehicle.hold.note}</span>}
          </span>
        </div>
      )}

      {vehicle ? (
        <PhotoManager vehicle={vehicle} onChange={(photos) => putCache({ ...vehicle, photos })} />
      ) : (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">Primero guarda los datos del auto; después podrás subir sus fotos.</p>
      )}

      <VehicleForm
        key={vehicle?.updatedAt ?? "new"}
        vehicle={vehicle}
        onSaved={(v) => {
          putCache(v);
          if (isNew) router.replace(`/dashboard/inventory/${v.id}`);
        }}
      />
    </div>
  );
}
