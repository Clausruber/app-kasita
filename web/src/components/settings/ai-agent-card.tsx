"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bot, Info } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { AiSettings } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const MODES = [
  { id: "off", label: "Apagado", hint: "El agente no hace nada." },
  { id: "manual", label: "Manual", hint: "Redacta un borrador en cada comentario nuevo; tú lo revisas y envías." },
  { id: "auto", label: "Automático", hint: "Responde y publica solo. Si duda, deja un borrador para ti." },
] as const;

const BRAND_FIELDS: { key: keyof AiSettings["brand"]; label: string; placeholder: string; rows: number }[] = [
  { key: "name", label: "Nombre de la marca", placeholder: "Agentika", rows: 1 },
  { key: "tone", label: "Tono", placeholder: "Cercano, positivo, con emojis moderados. Tuteo.", rows: 2 },
  { key: "about", label: "Sobre el negocio", placeholder: "Qué vendes, horarios, ubicación, web, cómo comprar…", rows: 4 },
  { key: "faq", label: "Preguntas frecuentes", placeholder: "P: ¿Hacen envíos? R: Sí, a todo el país en 48 h.", rows: 4 },
  { key: "never", label: "Nunca decir", placeholder: "No dar precios por comentario; no hablar de la competencia…", rows: 2 },
];

export function AiAgentCard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ["ai-settings", user?.uid],
    enabled: !!user,
    queryFn: () => api<AiSettings>("/api/settings/ai"),
  });

  // Local edits on top of the saved settings (null = no unsaved changes).
  const [draft, setDraft] = useState<AiSettings | null>(null);
  const form = draft ?? settings.data ?? null;
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!form) return;
    setBusy(true);
    try {
      const saved = await api<AiSettings>("/api/settings/ai", {
        method: "PUT",
        body: { mode: form.mode, instructions: form.instructions, brand: form.brand },
      });
      qc.setQueryData(["ai-settings", user?.uid], saved);
      setDraft(null);
      toast.success("Ajustes del agente guardados");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (settings.isLoading || !form) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Agente IA</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {settings.error ? (settings.error as Error).message : "Cargando…"}
        </CardContent>
      </Card>
    );
  }

  const set = <K extends keyof AiSettings>(k: K, v: AiSettings[K]) => setDraft({ ...form, [k]: v });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="size-5" /> Agente IA
        </CardTitle>
        <CardDescription>
          Responde los comentarios usando el texto del post, la conversación con cada persona y el perfil de tu marca.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Provider: global, managed by the SuperAdmin */}
        <p className="flex items-start gap-2 rounded-lg bg-muted/60 p-2.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          {form.hasKey && form.textModel ? (
            <span>
              Modelo: <strong className="text-foreground">{form.textModel}</strong>. El proveedor de IA lo configura el
              administrador.
            </span>
          ) : (
            <span>El administrador aún no ha configurado la IA. Puedes preparar las instrucciones mientras tanto.</span>
          )}
        </p>

        {/* Mode */}
        <section className="space-y-2">
          <Label>Modo</Label>
          <div className="grid gap-2 sm:grid-cols-3">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => set("mode", m.id)}
                className={cn(
                  "rounded-lg border p-3 text-left text-sm transition-colors hover:bg-muted/50",
                  form.mode === m.id && "border-primary bg-primary/5 ring-1 ring-primary",
                )}
              >
                <p className="font-medium">{m.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{m.hint}</p>
              </button>
            ))}
          </div>
        </section>

        {/* Instructions */}
        <section className="space-y-2">
          <Label htmlFor="instructions">Instrucciones del agente</Label>
          <Textarea
            id="instructions"
            rows={5}
            placeholder="Ej.: Agradece siempre el comentario. Si preguntan precio, invita a escribir por mensaje privado. Respuestas de máximo 2 frases."
            value={form.instructions}
            onChange={(e) => set("instructions", e.target.value)}
          />
        </section>

        {/* Brand */}
        <section className="space-y-3">
          <Label>Perfil de la marca</Label>
          {BRAND_FIELDS.map((f) => (
            <div key={f.key} className="space-y-1">
              <Label htmlFor={`brand-${f.key}`} className="text-xs text-muted-foreground">
                {f.label}
              </Label>
              {f.rows === 1 ? (
                <Input
                  id={`brand-${f.key}`}
                  placeholder={f.placeholder}
                  value={form.brand[f.key]}
                  onChange={(e) => set("brand", { ...form.brand, [f.key]: e.target.value })}
                />
              ) : (
                <Textarea
                  id={`brand-${f.key}`}
                  rows={f.rows}
                  placeholder={f.placeholder}
                  value={form.brand[f.key]}
                  onChange={(e) => set("brand", { ...form.brand, [f.key]: e.target.value })}
                />
              )}
            </div>
          ))}
        </section>

        <div className="flex justify-end border-t pt-4">
          <Button disabled={busy} onClick={save}>
            {busy ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
