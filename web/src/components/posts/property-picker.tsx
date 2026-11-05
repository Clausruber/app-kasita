"use client";

import { useMemo, useState } from "react";
import { Building2, Check, Search, X } from "lucide-react";
import { useProperties } from "@/hooks/use-properties";
import { priceLine } from "@/lib/property-catalog";
import type { Property } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export const MAX_PROPERTY_PHOTOS = 5;

type MediaItem = { url: string; type?: string; name?: string };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const closed = (p: Property) => p.status === "vendido" || p.status === "rentado";

/** Post text for a listing: its title, then its description. */
export const propertyText = (p: Property) => [p.title || p.propertyType, p.description?.trim()].filter(Boolean).join("\n\n");

const photoItem = (p: Property, i: number): MediaItem => ({ url: p.photos[i].url, type: "image", name: `${p.title} ${i + 1}` });

/**
 * Inventario: search a property by name, load its title and description into the post,
 * and choose up to five of its photos.
 */
export function PropertyPicker({
  propertyId,
  media,
  onPick,
  onMedia,
}: {
  propertyId: string | null;
  media: MediaItem[];
  onPick: (id: string, content: string, media: MediaItem[]) => void;
  onMedia: (media: MediaItem[]) => void;
}) {
  const { data, isLoading } = useProperties();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const properties = useMemo(() => (data?.properties ?? []).filter((p) => !closed(p)), [data]);
  const selected = properties.find((p) => p.id === propertyId) ?? null;

  const matches = useMemo(() => {
    const q = norm(query.trim());
    const list = q
      ? properties.filter((p) =>
          norm([p.title, p.development, p.stockNumber, p.location.neighborhood, p.location.city].join(" ")).includes(q),
        )
      : properties;
    return list.slice(0, 8);
  }, [properties, query]);

  function pick(p: Property) {
    const photos = p.photos.slice(0, MAX_PROPERTY_PHOTOS).map((_, i) => photoItem(p, i));
    onPick(p.id, propertyText(p), photos);
    setQuery("");
    setOpen(false);
  }

  function togglePhoto(url: string, i: number) {
    if (!selected) return;
    if (media.some((m) => m.url === url)) return onMedia(media.filter((m) => m.url !== url));
    if (media.length >= MAX_PROPERTY_PHOTOS) return;
    // Keep the property's own photo order.
    const order = (u: string) => selected.photos.findIndex((ph) => ph.url === u);
    onMedia([...media, photoItem(selected, i)].sort((a, b) => order(a.url) - order(b.url)));
  }

  return (
    <div className="space-y-3">
      <div className="relative space-y-2">
        <Label htmlFor="property-search">Propiedad</Label>
        {selected && !open ? (
          <div className="flex items-center gap-3 rounded-lg border p-2">
            <Thumb p={selected} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{selected.title || selected.propertyType}</p>
              <p className="truncate text-xs text-muted-foreground">{priceLine(selected)}</p>
            </div>
            <button type="button" className="text-xs text-primary hover:underline" onClick={() => setOpen(true)}>
              Cambiar
            </button>
          </div>
        ) : (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="property-search"
                autoFocus={open}
                className="pl-8"
                placeholder="Busca una propiedad por nombre…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onFocus={() => setOpen(true)}
              />
              {selected && (
                <button
                  type="button"
                  aria-label="Cancelar búsqueda"
                  className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground"
                  onClick={() => {
                    setQuery("");
                    setOpen(false);
                  }}
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
            {(open || !selected) && (
              <div className="max-h-72 overflow-y-auto rounded-lg border">
                {isLoading && <p className="p-3 text-sm text-muted-foreground">Cargando inventario…</p>}
                {!isLoading && !matches.length && (
                  <p className="p-3 text-sm text-muted-foreground">
                    {properties.length ? "Ninguna propiedad coincide." : "No hay propiedades disponibles en el inventario."}
                  </p>
                )}
                {matches.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => pick(p)}
                    className={cn("flex w-full items-center gap-3 p-2 text-left hover:bg-muted", p.id === propertyId && "bg-primary/5")}
                  >
                    <Thumb p={p} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{p.title || p.propertyType}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[priceLine(p), p.location.neighborhood || p.location.city, `${p.photos.length} fotos`].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {selected && (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <Label>Fotos</Label>
            <span className={cn("text-xs", media.length >= MAX_PROPERTY_PHOTOS ? "text-primary" : "text-muted-foreground")}>
              {media.length} de {MAX_PROPERTY_PHOTOS} seleccionadas
            </span>
          </div>
          {!selected.photos.length && <p className="text-sm text-muted-foreground">Esta propiedad no tiene fotos.</p>}
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {selected.photos.map((ph, i) => {
              const on = media.some((m) => m.url === ph.url);
              const full = !on && media.length >= MAX_PROPERTY_PHOTOS;
              return (
                <button
                  key={ph.url}
                  type="button"
                  aria-pressed={on}
                  aria-label={`Foto ${i + 1}`}
                  disabled={full}
                  onClick={() => togglePhoto(ph.url, i)}
                  className={cn(
                    "relative aspect-square overflow-hidden rounded-lg border-2 bg-muted transition",
                    on ? "border-primary" : "border-transparent",
                    full && "cursor-not-allowed opacity-40",
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={ph.url} alt="" className="size-full object-cover" loading="lazy" />
                  {on && (
                    <span className="absolute top-1 right-1 rounded-full bg-primary p-0.5 text-primary-foreground">
                      <Check className="size-3" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Thumb({ p }: { p: Property }) {
  return (
    <div className="relative size-12 shrink-0 overflow-hidden rounded-md bg-muted">
      {p.photos[0] ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.photos[0].url} alt="" className="size-full object-cover" loading="lazy" />
      ) : (
        <Building2 className="absolute inset-0 m-auto size-5 text-muted-foreground/50" />
      )}
    </div>
  );
}
