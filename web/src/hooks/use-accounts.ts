"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Account } from "@/lib/types";

export function useAccounts() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["accounts", user?.uid],
    enabled: !!user,
    queryFn: async () => (await api<{ accounts: Account[] }>("/api/accounts")).accounts,
  });
}
