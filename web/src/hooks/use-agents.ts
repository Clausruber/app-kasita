"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

export type AgentRef = { id: string; name: string };

/** Owner + active members ("owner" or member id → name): who attends visits. */
export function useAgents(enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["agents", user?.uid],
    enabled: !!user && enabled,
    staleTime: 60_000,
    queryFn: () => api<{ agents: AgentRef[] }>("/api/agendas/agents"),
  });
}
