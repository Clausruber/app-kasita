"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useMe } from "@/hooks/use-me";
import { can } from "@/lib/permissions";

const ORDER: [string, string][] = [
  ["inbox", "/dashboard/inbox"],
  ["posts", "/dashboard/posts"],
  ["clients", "/dashboard/clients"],
  ["calendar", "/dashboard/calendar"],
  ["agenda", "/dashboard/agenda"],
];

/** Opens the first section the user can use (Inbox for owners). */
export default function DashboardIndex() {
  const router = useRouter();
  const { data } = useMe();
  useEffect(() => {
    if (!data) return;
    router.replace(ORDER.find(([perm]) => can(data.perms, perm))?.[1] ?? "/dashboard/settings");
  }, [data, router]);
  return null;
}
