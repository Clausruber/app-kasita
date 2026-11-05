"use client";

import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Property } from "@/lib/types";

/** Inventory via the API (exact address and owner data are blanked for members without access). */
export function useProperties(enabled = true) {
  const { user } = useAuth();
  return useQuery({ queryKey: ["properties"], enabled: !!user && enabled, queryFn: () => api<{ properties: Property[] }>("/api/properties") });
}

/**
 * Photos uploaded before thumbnails existed get one in the background (a few per request) while the
 * list is open; the list refreshes once when they are done. Runs once per page visit.
 */
export function useThumbBackfill(properties: Property[] | undefined) {
  const qc = useQueryClient();
  const started = useRef(false);
  const missing = !!properties?.some((v) => v.photos.some((p) => !p.thumb));
  useEffect(() => {
    if (!missing || started.current) return;
    started.current = true;
    let cancelled = false;
    (async () => {
      for (let round = 0; round < 50 && !cancelled; round++) {
        const r = await api<{ done: number; remaining: number }>("/api/properties/thumbs", { method: "POST" }).catch(() => null);
        if (!r || !r.done || !r.remaining) break;
      }
      if (!cancelled) qc.invalidateQueries({ queryKey: ["properties"] });
    })();
    return () => {
      cancelled = true;
    };
  }, [missing, qc]);
}

export function useProperty(id: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["property", id],
    enabled: !!user && !!id,
    queryFn: () => api<{ property: Property }>(`/api/properties/${id}`),
  });
}

/** Writes a changed property into both caches (list and detail). */
export function usePutPropertyCache() {
  const qc = useQueryClient();
  return (v: Property) => {
    qc.setQueryData(["property", v.id], { property: v });
    qc.setQueryData<{ properties: Property[] }>(["properties"], (old) =>
      old && { properties: old.properties.some((x) => x.id === v.id) ? old.properties.map((x) => (x.id === v.id ? v : x)) : [v, ...old.properties] },
    );
  };
}
