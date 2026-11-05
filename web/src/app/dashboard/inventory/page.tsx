"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Building2, LayoutGrid, Map as MapIcon, Plus, Search } from "lucide-react";
import { useProperties } from "@/hooks/use-properties";
import { useCan } from "@/hooks/use-me";
import { OPERATIONS, PROPERTY_STATUS, PROPERTY_TYPES, daysOnMarket, forRent, forSale, priceLine, specsLine } from "@/lib/property-catalog";
import type { Operation, Property, PropertyStatus } from "@/lib/types";
import { DemoDataMenu } from "@/components/inventory/demo-data-menu";
import { StatusBadge } from "@/components/inventory/status-badge";
import { HoldBadge, HoldButtons } from "@/components/inventory/hold-dialog";
import { CloseButton } from "@/components/inventory/close-deal-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Leaflet touches `window`: load the map only in the browser.
const PropertiesMap = dynamic(() => import("@/components/inventory/properties-map"), {
  ssr: false,
  loading: () => <p className="text-sm text-muted-foreground">Cargando mapa…</p>,
});

// Listings older than this on the market get a warning badge.
const STALE_DAYS = 60;

const closed = (s: PropertyStatus) => s === "vendido" || s === "rentado";
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function PropertyCard({ v }: { v: Property }) {
  const days = daysOnMarket(v.intakeDate, v.closedAt);
  return (
    <div className="group flex flex-col overflow-hidden rounded-xl border hover:border-primary/40 hover:shadow-sm">
    <Link href={`/dashboard/inventory/${v.id}`} className="flex-1">
      <div className="relative aspect-[4/3] bg-muted">
        {v.photos[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={v.photos[0].url} alt={v.title} className="size-full object-cover" loading="lazy" />
        ) : (
          <Building2 className="absolute inset-0 m-auto size-10 text-muted-foreground/50" />
        )}
        <span className="absolute top-2 left-2 flex gap-1">
          <StatusBadge status={v.status} />
          {v.demo && <span className="rounded bg-violet-600/90 px-1.5 text-[11px] leading-5 text-white">Prueba</span>}
        </span>
        {!closed(v.status) && (
          <span
            className={cn(
              "absolute top-2 right-2 rounded bg-black/60 px-1.5 text-[11px] text-white",
              days > STALE_DAYS && "bg-red-600/90",
            )}
            title="Días en el mercado"
          >
            {days} d
          </span>
        )}
        {v.hold && <HoldBadge hold={v.hold} className="absolute bottom-2 left-2" />}
      </div>
      <div className="space-y-0.5 p-3">
        <p className="truncate text-sm font-medium">{v.title || v.propertyType}</p>
        <p className="text-lg font-semibold">{priceLine(v)}</p>
        <p className="truncate text-xs text-muted-foreground">
          {[v.propertyType, specsLine(v), v.location.neighborhood || v.location.city].filter(Boolean).join(" · ")}
        </p>
      </div>
    </Link>
      {(v.status === "disponible" || v.status === "apartado") && (
        <div className="flex flex-wrap items-center gap-1 border-t px-2 py-1.5">
          <HoldButtons property={v} size="xs" />
          <span className="ml-auto">
            <CloseButton property={v} size="xs" />
          </span>
        </div>
      )}
    </div>
  );
}

/** Propiedades: every listing with its cover photo, status, price and days on the market. */
export default function InventoryPage() {
  const { data, isLoading, error } = useProperties();
  const canEdit = useCan()("inventory.edit");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<PropertyStatus | "activos" | "all">("activos");
  const [type, setType] = useState("");
  const [operation, setOperation] = useState<Operation | "">("");
  const [maxPrice, setMaxPrice] = useState("");
  const [view, setView] = useState<"grid" | "map">("grid");
  const properties = useMemo(() => data?.properties ?? [], [data]);

  const visible = useMemo(() => {
    const term = norm(q.trim());
    const max = Number(maxPrice) || Infinity;
    return properties
      .filter((v) => (status === "all" ? true : status === "activos" ? !closed(v.status) : v.status === status))
      .filter((v) => !type || v.propertyType === type)
      .filter((v) => !operation || (operation === "venta" ? forSale(v.operation) : operation === "renta" ? forRent(v.operation) : v.operation === operation))
      .filter((v) => {
        // The price filter matches the operation being browsed (rent filters by monthly rent).
        const price = operation === "renta" ? v.rentPrice : forSale(v.operation) ? v.salePrice : v.rentPrice;
        return (price ?? 0) <= max;
      })
      .filter(
        (v) =>
          !term ||
          norm([v.title, v.propertyType, v.development, v.location.neighborhood, v.location.city, v.stockNumber, v.address].join(" ")).includes(term),
      );
  }, [properties, q, status, type, operation, maxPrice]);

  const counts = useMemo(
    () => Object.fromEntries(PROPERTY_STATUS.map((s) => [s.id, properties.filter((v) => v.status === s.id).length])) as Record<PropertyStatus, number>,
    [properties],
  );
  const stock = properties.filter((v) => v.status === "disponible" || v.status === "apartado");
  const avgDays = stock.length ? Math.round(stock.reduce((n, v) => n + daysOnMarket(v.intakeDate), 0) / stock.length) : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-semibold">
          Propiedades {properties.length > 0 && <span className="text-base font-normal text-muted-foreground">· {properties.length}</span>}
        </h1>
        <div className="flex rounded-lg border p-0.5">
          {(
            [
              ["grid", LayoutGrid, "Lista"],
              ["map", MapIcon, "Mapa"],
            ] as const
          ).map(([id, Icon, label]) => (
            <Button key={id} size="sm" variant={view === id ? "secondary" : "ghost"} aria-pressed={view === id} onClick={() => setView(id)}>
              <Icon /> {label}
            </Button>
          ))}
        </div>
        <DemoDataMenu demoCount={properties.filter((v) => v.demo).length} />
        {canEdit && (
          <Button nativeButton={false} render={<Link href="/dashboard/inventory/new" />}>
            <Plus /> Nueva propiedad
          </Button>
        )}
      </div>

      {properties.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {[
            ["Disponibles", counts.disponible],
            ["Apartados", counts.apartado],
            ["Vendidos", counts.vendido],
            ["Rentados", counts.rentado],
            ["Días promedio en el mercado", avgDays],
          ].map(([label, n]) => (
            <div key={label} className="rounded-xl border p-3">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-xl font-semibold">{n}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Buscar colonia, ciudad, desarrollo, clave…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select
          className="h-8 rounded-lg border bg-background px-2 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          aria-label="Filtrar por estado"
        >
          <option value="activos">En el mercado (sin cerrados)</option>
          {PROPERTY_STATUS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label} ({counts[s.id] ?? 0})
            </option>
          ))}
          <option value="all">Todos</option>
        </select>
        <select
          className="h-8 rounded-lg border bg-background px-2 text-sm"
          value={type}
          onChange={(e) => setType(e.target.value)}
          aria-label="Filtrar por tipo"
        >
          <option value="">Todos los tipos</option>
          {PROPERTY_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select
          className="h-8 rounded-lg border bg-background px-2 text-sm"
          value={operation}
          onChange={(e) => setOperation(e.target.value as typeof operation)}
          aria-label="Filtrar por operación"
        >
          <option value="">Venta y renta</option>
          {OPERATIONS.filter((o) => o.id !== "venta_renta").map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <Input
          className="w-40"
          type="number"
          inputMode="numeric"
          placeholder={operation === "renta" ? "Renta máxima" : "Precio máximo"}
          value={maxPrice}
          onChange={(e) => setMaxPrice(e.target.value)}
          aria-label="Precio máximo"
        />
      </div>

      {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : !visible.length ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          <Building2 className="mx-auto mb-2 size-8" />
          {properties.length ? "Ninguna propiedad coincide con los filtros." : "Aún no hay propiedades. Da de alta la primera con «Nueva propiedad»."}
        </div>
      ) : view === "map" ? (
        <PropertiesMap properties={visible} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((v) => (
            <PropertyCard key={v.id} v={v} />
          ))}
        </div>
      )}
    </div>
  );
}
