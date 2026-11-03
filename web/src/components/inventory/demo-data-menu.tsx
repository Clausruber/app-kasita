"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FlaskConical } from "lucide-react";
import { api } from "@/lib/api";
import { DEMO_COUNT } from "@/lib/demo-inventory";
import { useCan } from "@/hooks/use-me";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type Removed = { vehicles: number; deals: number; sales: number; tasks: number };

/** Inventario → Datos de prueba: loads or wipes 50 fake cars to try the system (agent, pipeline, posts). */
export function DemoDataMenu({ demoCount }: { demoCount: number }) {
  const can = useCan();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const canLoad = can("inventory.edit");
  const canDelete = can("inventory.delete");
  if (!canLoad && !canDelete) return null;

  const refresh = () => Promise.all(["vehicles", "deals", "tasks"].map((k) => qc.invalidateQueries({ queryKey: [k] })));

  async function load() {
    setBusy(true);
    try {
      await api("/api/vehicles/demo", { method: "POST" });
      await refresh();
      toast.success(`${DEMO_COUNT} autos de prueba cargados`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`¿Borrar los ${demoCount} autos de prueba? También se borran sus oportunidades, ventas y seguimientos.`)) return;
    setBusy(true);
    try {
      const r = await api<Removed>("/api/vehicles/demo", { method: "DELETE" });
      await refresh();
      const extra = [r.deals && `${r.deals} oportunidades`, r.sales && `${r.sales} ventas`, r.tasks && `${r.tasks} seguimientos`].filter(Boolean);
      toast.success(`${r.vehicles} autos de prueba borrados${extra.length ? ` (y ${extra.join(", ")})` : ""}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" disabled={busy} />}>
        <FlaskConical /> {busy ? "Procesando…" : demoCount ? `Datos de prueba · ${demoCount}` : "Datos de prueba"}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canLoad && (
          <DropdownMenuItem disabled={demoCount > 0} onClick={load}>
            Cargar {DEMO_COUNT} autos de prueba
          </DropdownMenuItem>
        )}
        {canDelete && (
          <DropdownMenuItem variant="destructive" disabled={!demoCount} onClick={remove}>
            Borrar autos de prueba
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
