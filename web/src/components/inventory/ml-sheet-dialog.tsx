"use client";

import { toast } from "sonner";
import { CircleAlert, Copy, Store } from "lucide-react";
import { mlMissing, toMlSheet } from "@/lib/mercadolibre";
import type { Vehicle } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

/** Copy-ready listing for Mercado Libre México, plus what is still missing. */
export function MlSheetDialog({ vehicle }: { vehicle: Vehicle }) {
  const sheet = toMlSheet(vehicle);
  const missing = mlMissing(vehicle);

  async function copy() {
    try {
      await navigator.clipboard.writeText(sheet);
      toast.success("Ficha copiada: pégala en Mercado Libre");
    } catch {
      toast.error("No se pudo copiar; selecciona el texto y cópialo a mano");
    }
  }

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Store /> Mercado Libre
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Ficha para Mercado Libre</DialogTitle>
          <DialogDescription>Autos y Camionetas · copia los datos y sube las fotos desde tu computadora.</DialogDescription>
        </DialogHeader>
        {missing.length > 0 && (
          <div className="flex gap-2 rounded-lg bg-amber-500/10 p-2 text-sm text-amber-800 dark:text-amber-300">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <span>Falta completar: {missing.join(", ")}.</span>
          </div>
        )}
        <pre className="max-h-[50vh] overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap">{sheet}</pre>
        <Button onClick={copy}>
          <Copy /> Copiar ficha
        </Button>
      </DialogContent>
    </Dialog>
  );
}
