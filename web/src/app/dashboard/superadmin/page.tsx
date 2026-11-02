"use client";

import { useMe } from "@/hooks/use-me";
import { GlobalAiCard } from "@/components/superadmin/global-ai-card";
import { TenantsCard } from "@/components/superadmin/tenants-card";

export default function SuperAdminPage() {
  const { data: me, isLoading } = useMe();
  if (isLoading) return <p className="text-sm text-muted-foreground">Cargando…</p>;
  // The API enforces this too; this only avoids rendering a page full of 403s.
  if (me?.role !== "superadmin") return <p className="text-sm text-muted-foreground">No tienes acceso a esta página.</p>;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">SuperAdmin</h1>
      <TenantsCard />
      <GlobalAiCard />
    </div>
  );
}
