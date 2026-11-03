"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Car, Plus, Search } from "lucide-react";
import { useVehicles } from "@/hooks/use-vehicles";
import { useCan } from "@/hooks/use-me";
import { VEHICLE_STATUS, daysOnLot, money } from "@/lib/vehicle-catalog";
import type { Vehicle, VehicleStatus } from "@/lib/types";
import { DemoDataMenu } from "@/components/inventory/demo-data-menu";
import { StatusBadge } from "@/components/inventory/status-badge";
import { HoldBadge, HoldButtons } from "@/components/inventory/hold-dialog";
import { SellButton } from "@/components/inventory/vehicle-sale-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Units older than this on the lot get a warning badge.
const STALE_DAYS = 60;

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function VehicleCard({ v }: { v: Vehicle }) {
  const days = daysOnLot(v.intakeDate, v.soldAt);
  return (
    <div className="group flex flex-col overflow-hidden rounded-xl border hover:border-primary/40 hover:shadow-sm">
    <Link href={`/dashboard/inventory/${v.id}`} className="flex-1">
      <div className="relative aspect-[4/3] bg-muted">
        {v.photos[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={v.photos[0].url} alt={v.title} className="size-full object-cover" loading="lazy" />
        ) : (
          <Car className="absolute inset-0 m-auto size-10 text-muted-foreground/50" />
        )}
        <span className="absolute top-2 left-2 flex gap-1">
          <StatusBadge status={v.status} />
          {v.demo && <span className="rounded bg-violet-600/90 px-1.5 text-[11px] leading-5 text-white">Prueba</span>}
        </span>
        {v.status !== "vendido" && (
          <span
            className={cn(
              "absolute top-2 right-2 rounded bg-black/60 px-1.5 text-[11px] text-white",
              days > STALE_DAYS && "bg-red-600/90",
            )}
            title="Días en el lote"
          >
            {days} d
          </span>
        )}
        {v.hold && <HoldBadge hold={v.hold} className="absolute bottom-2 left-2" />}
      </div>
      <div className="space-y-0.5 p-3">
        <p className="truncate text-sm font-medium">{v.title || `${v.brand} ${v.model} ${v.year}`}</p>
        <p className="text-lg font-semibold">{money(v.price)}</p>
        <p className="truncate text-xs text-muted-foreground">
          {[v.year, v.km ? `${v.km.toLocaleString("es-MX")} km` : null, v.transmission, v.location.city].filter(Boolean).join(" · ")}
        </p>
      </div>
    </Link>
      {(v.status === "disponible" || v.status === "apartado") && (
        <div className="flex flex-wrap items-center gap-1 border-t px-2 py-1.5">
          <HoldButtons vehicle={v} size="xs" />
          <span className="ml-auto">
            <SellButton vehicle={v} size="xs" />
          </span>
        </div>
      )}
    </div>
  );
}

/** Inventario: every unit on the lot with its cover photo, status and days on the lot. */
export default function InventoryPage() {
  const { data, isLoading, error } = useVehicles();
  const canEdit = useCan()("inventory.edit");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<VehicleStatus | "activos" | "all">("activos");
  const [maxPrice, setMaxPrice] = useState("");
  const vehicles = useMemo(() => data?.vehicles ?? [], [data]);

  const visible = useMemo(() => {
    const term = norm(q.trim());
    const max = Number(maxPrice) || Infinity;
    return vehicles
      .filter((v) => (status === "all" ? true : status === "activos" ? v.status !== "vendido" : v.status === status))
      .filter((v) => v.price <= max)
      .filter((v) => !term || norm([v.title, v.brand, v.model, v.trim, String(v.year), v.color, v.stockNumber].join(" ")).includes(term));
  }, [vehicles, q, status, maxPrice]);

  const counts = useMemo(
    () => Object.fromEntries(VEHICLE_STATUS.map((s) => [s.id, vehicles.filter((v) => v.status === s.id).length])) as Record<VehicleStatus, number>,
    [vehicles],
  );
  const stock = vehicles.filter((v) => v.status === "disponible" || v.status === "apartado");
  const avgDays = stock.length ? Math.round(stock.reduce((n, v) => n + daysOnLot(v.intakeDate), 0) / stock.length) : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-semibold">
          Inventario {vehicles.length > 0 && <span className="text-base font-normal text-muted-foreground">· {vehicles.length}</span>}
        </h1>
        <DemoDataMenu demoCount={vehicles.filter((v) => v.demo).length} />
        {canEdit && (
          <Button nativeButton={false} render={<Link href="/dashboard/inventory/new" />}>
            <Plus /> Nuevo auto
          </Button>
        )}
      </div>

      {vehicles.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ["Disponibles", counts.disponible],
            ["Apartados", counts.apartado],
            ["Vendidos", counts.vendido],
            ["Días promedio en lote", avgDays],
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
          <Input className="pl-8" placeholder="Buscar marca, modelo, año, color, stock…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select
          className="h-8 rounded-lg border bg-background px-2 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          aria-label="Filtrar por estado"
        >
          <option value="activos">En lote (sin vendidos)</option>
          {VEHICLE_STATUS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label} ({counts[s.id] ?? 0})
            </option>
          ))}
          <option value="all">Todos</option>
        </select>
        <Input
          className="w-40"
          type="number"
          inputMode="numeric"
          placeholder="Precio máximo"
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
          <Car className="mx-auto mb-2 size-8" />
          {vehicles.length ? "Ningún auto coincide con los filtros." : "Aún no hay autos. Da de alta el primero con «Nuevo auto»."}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((v) => (
            <VehicleCard key={v.id} v={v} />
          ))}
        </div>
      )}
    </div>
  );
}
