"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";

export type Me = {
  uid: string; // signed-in user
  workspaceUid: string; // owner whose data is shown (= uid for owners)
  email: string | null;
  role: "superadmin" | "admin" | "member";
  teamRole: "team" | "supervisor" | "admin" | null;
  perms: string[] | null; // null = owner, full access
  status: "pending" | "active" | "disabled";
};

export function useMe() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["me", user?.uid],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: () => api<Me>("/api/me"),
  });
}

/** The workspace uid for Firestore paths (team members read their owner's data). */
export function useWorkspaceUid() {
  return useMe().data?.workspaceUid ?? null;
}

/** Whether the signed-in user has an access key (owners have all). */
export function useCan() {
  const perms = useMe().data?.perms;
  return (key: string) => can(perms, key);
}
