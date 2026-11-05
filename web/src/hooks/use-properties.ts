"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Property } from "@/lib/types";

/** Inventory via the API (exact address and owner data are blanked for members without access). */
export function useProperties(enabled = true) {
  const { user } = useAuth();
  return useQuery({ queryKey: ["properties"], enabled: !!user && enabled, queryFn: () => api<{ properties: Property[] }>("/api/properties") });
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
