"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, ImagePlus, Star, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { MAX_PHOTOS } from "@/lib/vehicle-catalog";
import { uploadVehiclePhoto } from "@/lib/vehicle-photos";
import type { Vehicle, VehiclePhoto } from "@/lib/types";
import { useCan, useWorkspaceUid } from "@/hooks/use-me";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Upload = { name: string; pct: number };

/**
 * Vehicle photos in Firebase Storage: drop or pick several files, reorder (the first is the cover),
 * delete. Files are compressed in the browser before uploading.
 */
export function PhotoManager({ vehicle, onChange }: { vehicle: Vehicle; onChange: (photos: VehiclePhoto[]) => void }) {
  const ws = useWorkspaceUid();
  const canEdit = useCan()("inventory.edit");
  const input = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [over, setOver] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const photos = vehicle.photos;
  const room = MAX_PHOTOS - photos.length - uploads.length;

  async function addFiles(list: FileList | File[]) {
    if (!ws) return;
    const files = Array.from(list).filter((f) => f.type.startsWith("image/"));
    if (files.length > room) toast.warning(`Solo caben ${Math.max(0, room)} fotos más (máximo ${MAX_PHOTOS})`);
    const batch = files.slice(0, Math.max(0, room));
    setUploads((u) => [...u, ...batch.map((f) => ({ name: f.name, pct: 0 }))]);
    // Sequential: keeps the chosen order and avoids saturating mobile connections.
    for (const file of batch) {
      try {
        const photo = await uploadVehiclePhoto(ws, vehicle.id, file, (pct) =>
          setUploads((u) => u.map((x) => (x.name === file.name ? { ...x, pct } : x))),
        );
        const r = await api<{ photos: VehiclePhoto[] }>(`/api/vehicles/${vehicle.id}/photos`, { method: "POST", body: photo });
        onChange(r.photos);
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setUploads((u) => u.filter((x) => x.name !== file.name));
      }
    }
  }

  async function reorder(next: VehiclePhoto[]) {
    onChange(next); // optimistic
    try {
      const r = await api<{ photos: VehiclePhoto[] }>(`/api/vehicles/${vehicle.id}/photos`, { method: "PUT", body: { order: next.map((p) => p.path) } });
      onChange(r.photos);
    } catch (e) {
      onChange(photos);
      toast.error((e as Error).message);
    }
  }

  const move = (from: number, to: number) => {
    if (to < 0 || to >= photos.length || from === to) return;
    const next = [...photos];
    next.splice(to, 0, next.splice(from, 1)[0]);
    reorder(next);
  };

  async function remove(p: VehiclePhoto) {
    if (!confirm("¿Borrar esta foto?")) return;
    try {
      const r = await api<{ photos: VehiclePhoto[] }>(`/api/vehicles/${vehicle.id}/photos?path=${encodeURIComponent(p.path)}`, { method: "DELETE" });
      onChange(r.photos);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="mr-auto text-sm font-semibold">
          Fotos <span className="font-normal text-muted-foreground">· {photos.length}/{MAX_PHOTOS} · la primera es la portada</span>
        </h3>
        {canEdit && (
          <Button size="sm" variant="outline" disabled={room <= 0} onClick={() => input.current?.click()}>
            <ImagePlus /> Agregar fotos
          </Button>
        )}
        <input
          ref={input}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      <div
        onDragOver={(e) => {
          if (!canEdit || dragFrom !== null) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          setOver(false);
          if (dragFrom !== null || !canEdit) return;
          e.preventDefault();
          addFiles(e.dataTransfer.files);
        }}
        className={cn("rounded-xl border border-dashed p-2", over && "border-primary bg-primary/5")}
      >
        {!photos.length && !uploads.length ? (
          <button
            type="button"
            disabled={!canEdit}
            onClick={() => input.current?.click()}
            className="flex w-full flex-col items-center gap-1 py-10 text-sm text-muted-foreground"
          >
            <ImagePlus className="size-8" />
            {canEdit ? "Arrastra fotos aquí o haz clic para elegirlas" : "Sin fotos"}
          </button>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {photos.map((p, i) => (
              <li
                key={p.path}
                draggable={canEdit}
                onDragStart={() => setDragFrom(i)}
                onDragEnd={() => setDragFrom(null)}
                onDragOver={(e) => dragFrom !== null && e.preventDefault()}
                onDrop={(e) => {
                  if (dragFrom === null) return;
                  e.preventDefault();
                  e.stopPropagation();
                  move(dragFrom, i);
                  setDragFrom(null);
                }}
                className={cn("group relative aspect-[4/3] overflow-hidden rounded-lg bg-muted", dragFrom === i && "opacity-40")}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={`Foto ${i + 1}`} className="size-full object-cover" loading="lazy" />
                {i === 0 && (
                  <span className="absolute top-1 left-1 flex items-center gap-0.5 rounded bg-black/60 px-1.5 text-[11px] text-white">
                    <Star className="size-3 fill-current" /> Portada
                  </span>
                )}
                {canEdit && (
                  <div className="absolute inset-x-1 bottom-1 flex gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                    <Button size="icon-xs" variant="secondary" aria-label="Mover a la izquierda" disabled={i === 0} onClick={() => move(i, i - 1)}>
                      <ArrowLeft />
                    </Button>
                    <Button size="icon-xs" variant="secondary" aria-label="Mover a la derecha" disabled={i === photos.length - 1} onClick={() => move(i, i + 1)}>
                      <ArrowRight />
                    </Button>
                    {i !== 0 && (
                      <Button size="icon-xs" variant="secondary" aria-label="Usar como portada" onClick={() => move(i, 0)}>
                        <Star />
                      </Button>
                    )}
                    <Button size="icon-xs" variant="destructive" className="ml-auto" aria-label="Borrar foto" onClick={() => remove(p)}>
                      <Trash2 />
                    </Button>
                  </div>
                )}
              </li>
            ))}
            {uploads.map((u) => (
              <li key={u.name} className="flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-lg bg-muted p-2 text-xs text-muted-foreground">
                <span className="w-full truncate text-center">{u.name}</span>
                <span className="h-1.5 w-full overflow-hidden rounded-full bg-background">
                  <span className="block h-full bg-primary transition-all" style={{ width: `${u.pct}%` }} />
                </span>
                {u.pct}%
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
