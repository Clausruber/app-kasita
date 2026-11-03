"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { BellRing } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Ajustes → Agente: when an unanswered DM becomes a task in Seguimientos. */
export function FollowUpCard() {
  const { data } = useQuery({ queryKey: ["followup"], queryFn: () => api<{ staleHours: number }>("/api/settings/followup") });
  // Unsaved edit; null shows the stored value.
  const [draft, setHours] = useState<string | null>(null);
  const hours = draft ?? (data ? String(data.staleHours) : "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const r = await api<{ staleHours: number }>("/api/settings/followup", { method: "PUT", body: { staleHours: Number(hours) } });
      setHours(String(r.staleHours));
      toast.success("Seguimiento automático guardado");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellRing className="size-4" /> Seguimiento automático
        </CardTitle>
        <CardDescription>
          Si un cliente escribe por mensaje directo y nadie le responde, se crea un pendiente en Seguimientos. Los apartados que vencen en menos de 24 h
          también generan un aviso.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="fu-hours">Avisar después de (horas sin respuesta)</Label>
          <Input id="fu-hours" className="w-28" type="number" min={1} max={72} value={hours} onChange={(e) => setHours(e.target.value)} />
        </div>
        <Button disabled={saving || !data || String(data.staleHours) === hours} onClick={save}>
          {saving ? "Guardando…" : "Guardar"}
        </Button>
      </CardContent>
    </Card>
  );
}
