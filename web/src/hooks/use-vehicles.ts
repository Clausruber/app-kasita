"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Vehicle } from "@/lib/types";

/** Inventory via the API (VIN and plates are blanked for members without access). */
export function useVehicles(enabled = true) {
  const { user } = useAuth();
  return useQuery({ queryKey: ["vehicles"], enabled: !!user && enabled, queryFn: () => api<{ vehicles: Vehicle[] }>("/api/vehicles") });
}

export function useVehicle(id: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["vehicle", id],
    enabled: !!user && !!id,
    queryFn: () => api<{ vehicle: Vehicle }>(`/api/vehicles/${id}`),
  });
}

/** Writes a changed vehicle into both caches (list and detail). */
export function usePutVehicleCache() {
  const qc = useQueryClient();
  return (v: Vehicle) => {
    qc.setQueryData(["vehicle", v.id], { vehicle: v });
    qc.setQueryData<{ vehicles: Vehicle[] }>(["vehicles"], (old) =>
      old && { vehicles: old.vehicles.some((x) => x.id === v.id) ? old.vehicles.map((x) => (x.id === v.id ? v : x)) : [v, ...old.vehicles] },
    );
  };
}
