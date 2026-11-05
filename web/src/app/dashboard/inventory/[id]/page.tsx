"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { daysOnMarket, money, priceLine } from "@/lib/property-catalog";
import type { Property } from "@/lib/types";
import { useCan } from "@/hooks/use-me";
import { usePutPropertyCache, useProperty } from "@/hooks/use-properties";
import { NewDealButton } from "@/components/deals/deal-dialogs";
import { QuoteButton } from "@/components/quotes/catalog-drawer";
import { PhotoManager } from "@/components/inventory/photo-manager";
import { PublishPropertyDialog } from "@/components/inventory/publish-property-dialog";
import { StatusBadge } from "@/components/inventory/status-badge";
import { HoldBadge, HoldButtons, holdUntil } from "@/components/inventory/hold-dialog";
import { CloseButton, RelistButton } from "@/components/inventory/close-deal-dialog";
import { PropertyForm } from "@/components/inventory/property-form";
import { Button } from "@/components/ui/button";

/** Property sheet: data, photos and actions. `/dashboard/inventory/new` creates one. */
export default function PropertyPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";
  const router = useRouter();
  const qc = useQueryClient();
  const can = useCan();
  const putCache = usePutPropertyCache();
  const { data, isLoading, error } = useProperty(isNew ? null : id);
  const property = data?.property ?? null;
  const closed = property?.status === "vendido" || property?.status === "rentado";

  async function remove(v: Property) {
    if (!confirm(`¿Borrar ${v.title} y todas sus fotos? No se puede deshacer.`)) return;
    try {
      await api(`/api/properties/${v.id}`, { method: "DELETE" });
      qc.setQueryData<{ properties: Property[] }>(["properties"], (old) => old && { properties: old.properties.filter((x) => x.id !== v.id) });
      toast.success("Propiedad borrada");
      router.replace("/dashboard/inventory");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (!isNew && isLoading) return <p className="text-sm text-muted-foreground">Cargando…</p>;
  if (!isNew && (error || !property)) return <p className="text-sm text-destructive">{(error as Error)?.message ?? "Propiedad no encontrada"}</p>;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="icon-sm" aria-label="Volver a propiedades" nativeButton={false} render={<Link href="/dashboard/inventory" />}>
          <ArrowLeft />
        </Button>
        <div className="mr-auto min-w-0">
          <h1 className="flex items-center gap-2 truncate text-xl font-semibold">
            {property ? property.title || property.propertyType : "Nueva propiedad"}
            {property && <StatusBadge status={property.status} />}
          </h1>
          {property && (
            <p className="text-sm text-muted-foreground">
              {priceLine(property)} · {daysOnMarket(property.intakeDate, property.closedAt)} días en el mercado
              {property.reservation && ` · apartado con ${money(property.reservation.amount)}`}
              {property.lease &&
                ` · rentado en ${money(property.lease.monthlyRent)}/mes hasta el ${new Date(property.lease.end).toLocaleDateString("es-MX")}`}
            </p>
          )}
        </div>
        {property && (
          <div className="flex flex-wrap gap-2">
            {!closed && <NewDealButton prefill={{ propertyId: property.id }} />}
            {!closed && property.status !== "borrador" && <QuoteButton prefill={{ propertyIds: [property.id] }} />}
            <HoldButtons property={property} />
            <CloseButton property={property} />
            <RelistButton property={property} />
            {can("posts.create") && <PublishPropertyDialog property={property} />}
            {can("inventory.delete") && !closed && (
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => remove(property)}>
                <Trash2 /> Borrar
              </Button>
            )}
          </div>
        )}
      </div>

      {property?.hold && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          <HoldBadge hold={property.hold} />
          <span>
            Bloqueado por <strong>{property.hold.byName || "un asesor"}</strong> {holdUntil(property.hold.until)}
            {property.hold.note && <span className="text-muted-foreground"> · {property.hold.note}</span>}
          </span>
        </div>
      )}

      {property ? (
        <PhotoManager property={property} onChange={(photos) => putCache({ ...property, photos })} />
      ) : (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">Primero guarda los datos de la propiedad; después podrás subir sus fotos.</p>
      )}

      <PropertyForm
        key={property?.updatedAt ?? "new"}
        property={property}
        onSaved={(v) => {
          putCache(v);
          if (isNew) router.replace(`/dashboard/inventory/${v.id}`);
        }}
      />
    </div>
  );
}
