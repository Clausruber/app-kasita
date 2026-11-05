"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo } from "react";
import Link from "next/link";
import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import { priceLine, specsLine, statusLabel } from "@/lib/property-catalog";
import type { Property, PropertyStatus } from "@/lib/types";

// Pin colour per status (same hues as StatusBadge).
const COLORS: Record<PropertyStatus, string> = {
  borrador: "#9ca3af",
  disponible: "#059669",
  apartado: "#d97706",
  vendido: "#0284c7",
  rentado: "#4f46e5",
};
const RESIDENTIAL = new Set(["Departamento", "Casa", "Casa en condominio"]);

// Plain SVG pins (no image files): a circle for residential, a rounded square for commercial.
const icons = new Map<string, L.DivIcon>();
function iconFor(status: PropertyStatus, residential: boolean) {
  const key = `${status}-${residential}`;
  if (!icons.has(key)) {
    const shape = residential ? '<circle cx="12" cy="12" r="8"/>' : '<rect x="4.5" y="4.5" width="15" height="15" rx="3"/>';
    icons.set(
      key,
      L.divIcon({
        className: "",
        html: `<svg width="24" height="24" viewBox="0 0 24 24" fill="${COLORS[status]}" stroke="white" stroke-width="2.5" style="filter:drop-shadow(0 1px 2px rgb(0 0 0 / .4))">${shape}</svg>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        popupAnchor: [0, -10],
      }),
    );
  }
  return icons.get(key)!;
}

type Pinned = Property & { location: Property["location"] & { lat: number; lng: number } };

/** Keeps every pin in view when the filtered list changes. */
function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  const key = points.map((p) => p.join(",")).join(";");
  useEffect(() => {
    if (points.length === 1) map.setView(points[0], 15);
    else if (points.length) map.fitBounds(points, { padding: [32, 32], maxZoom: 15 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  return null;
}

/** Map of the listings that have coordinates (OpenStreetMap tiles, no API key). */
export default function PropertiesMap({ properties }: { properties: Property[] }) {
  const pinned = useMemo(() => properties.filter((p): p is Pinned => p.location.lat != null && p.location.lng != null), [properties]);
  const points = pinned.map((p) => [p.location.lat, p.location.lng] as [number, number]);
  const residential = pinned.filter((p) => RESIDENTIAL.has(p.propertyType)).length;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          {pinned.length} en el mapa
          {pinned.length > 0 && ` · ${Math.round((residential / pinned.length) * 100)} % residencial`}
          {properties.length > pinned.length && ` · ${properties.length - pinned.length} sin coordenadas`}
        </span>
        <span className="flex items-center gap-1">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="12" r="9" />
          </svg>
          Residencial
        </span>
        <span className="flex items-center gap-1">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <rect x="3" y="3" width="18" height="18" rx="4" />
          </svg>
          Comercial
        </span>
        {(["disponible", "apartado", "vendido", "rentado"] as const).map((s) => (
          <span key={s} className="flex items-center gap-1">
            <span className="size-2.5 rounded-full" style={{ background: COLORS[s] }} />
            {statusLabel(s)}
          </span>
        ))}
      </div>
      <div className="isolate h-[65vh] min-h-80 overflow-hidden rounded-xl border">
        <MapContainer center={[20.6767, -103.3475]} zoom={12} scrollWheelZoom className="size-full">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitBounds points={points} />
          {pinned.map((p) => (
            <Marker key={p.id} position={[p.location.lat, p.location.lng]} icon={iconFor(p.status, RESIDENTIAL.has(p.propertyType))}>
              <Popup>
                <Link href={`/dashboard/inventory/${p.id}`} className="block w-52 space-y-0.5 !text-inherit no-underline">
                  {p.photos[0] && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.photos[0].url} alt="" className="mb-1 aspect-[4/3] w-full rounded object-cover" />
                  )}
                  <span className="block text-sm font-semibold">{p.title || p.propertyType}</span>
                  <span className="block font-medium">{priceLine(p)}</span>
                  <span className="block text-xs opacity-70">
                    {[statusLabel(p.status), specsLine(p), p.location.neighborhood].filter(Boolean).join(" · ")}
                  </span>
                </Link>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}
