"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bot, KeyRound, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type GlobalAi = { textModel: string | null; hasKey: boolean; keyHint: string | null };
type Model = { id: string; name: string; context: number | null; prompt: number | null; completion: number | null };

/** OpenRouter key + text model shared by every account's agent. */
export function GlobalAiCard() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["admin-ai"], queryFn: () => api<GlobalAi>("/api/admin/ai") });
  const models = useQuery({
    queryKey: ["ai-models"],
    staleTime: 3600_000,
    queryFn: async () => (await api<{ models: Model[] }>("/api/ai/models")).models,
  });
  const [key, setKey] = useState("");
  const [model, setModel] = useState<string | null | undefined>(undefined); // undefined = unchanged
  const [busy, setBusy] = useState<null | "save" | "test" | "clear">(null);

  const currentModel = model === undefined ? (settings.data?.textModel ?? null) : model;
  const selected = models.data?.find((m) => m.id === currentModel);

  async function save(body: Record<string, unknown>, kind: "save" | "clear") {
    setBusy(kind);
    try {
      qc.setQueryData(["admin-ai"], await api<GlobalAi>("/api/admin/ai", { method: "PUT", body }));
      qc.invalidateQueries({ queryKey: ["ai-settings"] });
      setKey("");
      setModel(undefined);
      toast.success("Configuración global de IA guardada");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    try {
      const r = await api<{ label: string | null; remaining: number | null }>("/api/admin/ai/test", { method: "POST" });
      toast.success(`Key válida${r.label ? ` (${r.label})` : ""}${r.remaining != null ? ` · saldo: $${r.remaining.toFixed(2)}` : ""}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="size-5" /> IA global
        </CardTitle>
        <CardDescription>
          La API key de OpenRouter y el modelo de texto se usan en todas las cuentas. Cada cuenta configura su modo,
          instrucciones, perfil de marca y conocimiento.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <section className="space-y-2">
          <Label htmlFor="or-key" className="flex items-center gap-1.5">
            <KeyRound className="size-4" /> API key de OpenRouter
          </Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="or-key"
              type="password"
              autoComplete="off"
              className="min-w-0 flex-1"
              placeholder={settings.data?.hasKey ? `Guardada (${settings.data.keyHint}) · escribe otra para cambiarla` : "sk-or-v1-…"}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <Button variant="outline" disabled={!settings.data?.hasKey || !!busy} onClick={test}>
              {busy === "test" ? "Probando…" : "Probar"}
            </Button>
            {settings.data?.hasKey && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Borrar key"
                disabled={!!busy}
                onClick={() => confirm("¿Borrar la key? El agente dejará de funcionar en todas las cuentas.") && save({ clearKey: true }, "clear")}
              >
                <Trash2 />
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">Se guarda cifrada en el servidor y nunca vuelve al navegador.</p>
        </section>

        <section className="space-y-2">
          <Label htmlFor="model">Modelo de texto (OpenAI)</Label>
          <select
            id="model"
            className="h-9 w-full rounded-lg border bg-background px-2 text-sm"
            value={currentModel ?? ""}
            onChange={(e) => setModel(e.target.value || null)}
            disabled={models.isLoading}
          >
            <option value="">{models.isLoading ? "Cargando modelos…" : "Elige un modelo"}</option>
            {models.data?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.prompt != null ? ` — $${m.prompt} / $${m.completion} por 1M tokens` : ""}
              </option>
            ))}
          </select>
          {selected?.context && (
            <p className="text-xs text-muted-foreground">
              {selected.id} · contexto de {selected.context.toLocaleString("es")} tokens
            </p>
          )}
        </section>

        <div className="flex justify-end border-t pt-4">
          <Button
            disabled={!!busy || (!key.trim() && model === undefined)}
            onClick={() => save({ ...(key.trim() ? { openrouterKey: key.trim() } : {}), ...(model !== undefined ? { textModel: model } : {}) }, "save")}
          >
            {busy === "save" ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
