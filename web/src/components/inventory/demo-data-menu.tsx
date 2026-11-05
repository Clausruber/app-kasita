"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FlaskConical, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { DEMO_COUNT } from "@/lib/demo-inventory";
import { useCan } from "@/hooks/use-me";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type Removed = { properties: number; deals: number; sales: number; tasks: number };

/** Propiedades → Datos de prueba: loads or wipes the fake Guadalajara properties to try the system (agent, pipeline, posts). */
export function DemoDataMenu({ demoCount }: { demoCount: number }) {
  const can = useCan();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<false | "load" | "delete">(false);
  const canLoad = can("inventory.edit");
  const canDelete = can("inventory.delete");
  if (!canLoad && !canDelete) return null;

  const refresh = () => Promise.all(["properties", "deals", "tasks"].map((k) => qc.invalidateQueries({ queryKey: [k] })));

  async function load() {
    setBusy("load");
    try {
      const r = await api<{ photos: boolean }>("/api/properties/demo", { method: "POST" });
      await refresh();
      if (r.photos) toast.success(`${DEMO_COUNT} propiedades de prueba cargadas con fotos`);
      else toast.warning(`${DEMO_COUNT} propiedades de prueba cargadas sin fotos: Firebase Storage no está disponible`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`¿Borrar las ${demoCount} propiedades de prueba? También se borran sus fotos, oportunidades, ventas y seguimientos.`)) return;
    setBusy("delete");
    try {
      const r = await api<Removed>("/api/properties/demo", { method: "DELETE" });
      await refresh();
      const extra = [r.deals && `${r.deals} oportunidades`, r.sales && `${r.sales} ventas`, r.tasks && `${r.tasks} seguimientos`].filter(Boolean);
      toast.success(`${r.properties} propiedades de prueba borradas${extra.length ? ` (y ${extra.join(", ")})` : ""}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Visible on its own (not only in the menu) while there is test data to remove. */}
      {canDelete && demoCount > 0 && (
        <Button variant="outline" className="text-destructive" disabled={!!busy} onClick={remove}>
          <Trash2 /> {busy === "delete" ? "Borrando…" : "Borrar datos de prueba"}
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" disabled={!!busy} />}>
          <FlaskConical /> {busy === "load" ? "Cargando fotos…" : busy ? "Procesando…" : demoCount ? `Datos de prueba · ${demoCount}` : "Datos de prueba"}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canLoad && (
            <DropdownMenuItem disabled={demoCount > 0} onClick={load}>
              Cargar {DEMO_COUNT} propiedades de prueba
            </DropdownMenuItem>
          )}
          {canDelete && (
            <DropdownMenuItem variant="destructive" disabled={!demoCount} onClick={remove}>
              Borrar propiedades de prueba
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
