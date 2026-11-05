"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Deal } from "@/lib/types";

export type Seller = { id: string; name: string };
export type DealsData = { deals: Deal[]; sellers: Seller[]; me: string | null };

export function useDeals() {
  const { user } = useAuth();
  return useQuery({ queryKey: ["deals"], enabled: !!user, queryFn: () => api<DealsData>("/api/deals") });
}

/** Writes a changed deal into the board cache; a deal sold or reserved also changes the inventory. */
export function usePutDeal() {
  const qc = useQueryClient();
  return (d: Deal, { propertyChanged = false } = {}) => {
    qc.setQueryData<DealsData>(["deals"], (old) =>
      old && { ...old, deals: old.deals.some((x) => x.id === d.id) ? old.deals.map((x) => (x.id === d.id ? d : x)) : [d, ...old.deals] },
    );
    if (propertyChanged) {
      qc.invalidateQueries({ queryKey: ["properties"] });
      qc.invalidateQueries({ queryKey: ["property"] });
      qc.invalidateQueries({ queryKey: ["deals"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    }
  };
}
