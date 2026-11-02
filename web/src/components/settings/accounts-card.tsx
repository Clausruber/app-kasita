"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Unplug } from "lucide-react";
import { api } from "@/lib/api";
import { PLATFORMS } from "@/lib/platforms";
import { useAccounts } from "@/hooks/use-accounts";
import { PlatformBadge } from "@/components/shared/platform-badge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** Ajustes → connected social accounts (Zernio OAuth) and the networks you can connect. */
export function AccountsCard() {
  const { data: accounts = [], isLoading, error } = useAccounts();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  async function connect(platform: string) {
    setBusy(platform);
    try {
      const { authUrl } = await api<{ authUrl: string }>("/api/accounts/connect", { method: "POST", body: { platform } });
      window.location.assign(authUrl);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(null);
    }
  }

  async function disconnect(id: string) {
    if (!confirm("¿Desconectar esta cuenta?")) return;
    setBusy(id);
    try {
      await api(`/api/accounts/${id}`, { method: "DELETE" });
      toast.success("Cuenta desconectada");
      qc.invalidateQueries({ queryKey: ["accounts"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Redes sociales</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-1">
          <p className="text-sm font-medium">Conectadas</p>
          {isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
          {!isLoading && !accounts.length && !error && (
            <p className="text-sm text-muted-foreground">Aún no has conectado ninguna cuenta.</p>
          )}
          <ul className="divide-y">
            {accounts.map((a) => (
              <li key={a._id} className="flex items-center gap-3 py-2">
                {a.profilePicture ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.profilePicture} alt="" className="size-8 rounded-full" />
                ) : (
                  <div className="size-8 rounded-full bg-muted" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{a.displayName || a.username}</p>
                  <PlatformBadge platform={a.platform} className="text-muted-foreground" />
                </div>
                {a.isActive === false && <Badge variant="destructive">Reconectar</Badge>}
                <Button variant="ghost" size="sm" disabled={busy === a._id} onClick={() => disconnect(a._id)}>
                  <Unplug /> Desconectar
                </Button>
              </li>
            ))}
          </ul>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">Conectar una red</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {PLATFORMS.map((p) => (
              <Button key={p.id} variant="outline" className="justify-start" disabled={!!busy} onClick={() => connect(p.id)}>
                <Plus />
                <PlatformBadge platform={p.id} />
              </Button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
