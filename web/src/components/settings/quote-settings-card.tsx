"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { TERM_OPTIONS, monthlyPayment, termLabel, type QuoteDefaults } from "@/lib/quote-math";
import { money } from "@/lib/property-catalog";
import { useQuoteDefaults } from "@/components/quotes/catalog-drawer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const EXAMPLE = 3_000_000; // price used for the sample payment

/** Ajustes → Empresa → Cotizaciones: defaults of the catalog drawer and the PDF conditions. */
export function QuoteSettingsCard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const saved = useQuoteDefaults();
  const [draft, setDraft] = useState<QuoteDefaults | null>(null);
  const form = draft ?? saved.data ?? null;
  const [saving, setSaving] = useState(false);
  if (!form) return null;
  const set = <K extends keyof QuoteDefaults>(k: K, v: QuoteDefaults[K]) => setDraft({ ...form, [k]: v });
  const mid = form.terms[Math.floor((form.terms.length - 1) / 2)];
  const sample = mid ? monthlyPayment(EXAMPLE * (1 - form.minDownPct / 100), form.rate, mid) : 0;

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      qc.setQueryData(["quote-defaults", user?.uid], await api<QuoteDefaults>("/api/settings/quotes", { method: "PUT", body: form }));
      setDraft(null);
      toast.success("Valores de cotización guardados");
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
          <FileText className="size-5" /> Cotizaciones
        </CardTitle>
        <CardDescription>Valores del simulador de crédito hipotecario del catálogo/cotización en PDF; el asesor puede cambiarlos en cada uno.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="qs-rate">Tasa anual (%)</Label>
            <Input id="qs-rate" type="number" min={0} step={0.1} value={form.rate} onChange={(e) => set("rate", Number(e.target.value))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="qs-down">Enganche mínimo (%)</Label>
            <Input id="qs-down" type="number" min={0} max={90} value={form.minDownPct} onChange={(e) => set("minDownPct", Number(e.target.value))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="qs-valid">Vigencia (días)</Label>
            <Input id="qs-valid" type="number" min={1} max={90} value={form.validDays} onChange={(e) => set("validDays", Number(e.target.value))} />
          </div>
        </div>
        <div className="space-y-1">
          <Label>Plazos</Label>
          <div className="flex flex-wrap gap-1.5">
            {TERM_OPTIONS.map((t) => {
              const on = form.terms.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => set("terms", on ? form.terms.filter((x) => x !== t) : [...form.terms, t].sort((a, b) => a - b))}
                  className={cn("rounded-md border px-2.5 py-1 text-sm", on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
                >
                  {termLabel(t)}
                </button>
              );
            })}
          </div>
        </div>
        {mid && (
          <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            Ejemplo: una propiedad de {money(EXAMPLE)} con {form.minDownPct}% de enganche queda en <strong className="text-foreground">{money(sample)}</strong> al
            mes a {termLabel(mid)}.
          </p>
        )}
        <div className="space-y-1">
          <Label htmlFor="qs-cond">Condiciones (aparecen en el PDF)</Label>
          <Textarea id="qs-cond" rows={3} value={form.conditions} onChange={(e) => set("conditions", e.target.value)} />
        </div>
        <div className="flex justify-end gap-2 border-t pt-4">
          {draft && (
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Descartar
            </Button>
          )}
          <Button disabled={saving || !draft || !form.terms.length} onClick={save}>
            {saving ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
