"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bot } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { AiSettings } from "@/lib/types";
import { cn } from "@/lib/utils";

const MODES = [
  { id: "off", label: "Apagado", title: "El agente no responde" },
  { id: "manual", label: "Manual", title: "El agente deja un borrador; tú lo envías" },
  { id: "auto", label: "Automático", title: "El agente responde y publica solo" },
] as const;

/** Switches the AI agent mode from the inbox. Shares its cache with Ajustes → Agente IA. */
export function AgentModeToggle() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = ["ai-settings", user?.uid];
  const { data, isLoading } = useQuery({
    queryKey: key,
    enabled: !!user,
    queryFn: () => api<AiSettings>("/api/settings/ai"),
  });
  const [saving, setSaving] = useState(false);

  async function setMode(mode: AiSettings["mode"]) {
    if (!data || mode === data.mode) return;
    if (mode !== "off" && (!data.hasKey || !data.textModel)) {
      toast.error("El administrador aún no ha configurado la IA (API key de OpenRouter y modelo)");
      return;
    }
    setSaving(true);
    qc.setQueryData(key, { ...data, mode }); // optimistic
    try {
      qc.setQueryData(key, await api<AiSettings>("/api/settings/ai", { method: "PUT", body: { mode } }));
      toast.success(mode === "auto" ? "Agente en automático: responderá y publicará solo" : mode === "manual" ? "Agente en manual: dejará borradores" : "Agente apagado");
    } catch (e) {
      qc.setQueryData(key, data);
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const ready = data?.hasKey && data?.textModel;
  return (
    <div className="flex items-center gap-1.5">
      <Link
        href="/dashboard/settings#agente"
        title="Configurar el agente IA"
        className={cn("flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground", data?.mode === "auto" && "text-violet-600 dark:text-violet-400")}
      >
        <Bot className="size-4" />
        <span className="hidden sm:inline">Agente</span>
      </Link>
      <div className="flex rounded-lg border p-0.5" role="radiogroup" aria-label="Modo del agente IA">
        {MODES.map((m) => {
          const active = data?.mode === m.id;
          return (
            <button
              key={m.id}
              role="radio"
              aria-checked={active}
              title={m.id !== "off" && !ready ? "El administrador aún no ha configurado la IA" : m.title}
              disabled={isLoading || saving}
              onClick={() => setMode(m.id)}
              className={cn(
                "rounded-md px-2.5 py-1 text-sm transition-colors disabled:opacity-60",
                active
                  ? m.id === "auto"
                    ? "bg-violet-600 text-white"
                    : m.id === "manual"
                      ? "bg-secondary font-medium"
                      : "bg-muted font-medium"
                  : "text-muted-foreground hover:bg-muted/60",
              )}
            >
              {m.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
