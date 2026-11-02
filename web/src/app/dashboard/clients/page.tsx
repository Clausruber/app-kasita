"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";
import { ArrowLeft, Download, Phone, Search } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { PLATFORMS, platformName } from "@/lib/platforms";
import type { Client } from "@/lib/types";
import { Avatar } from "@/components/inbox/commenter-list";
import { ClientDetail } from "@/components/clients/client-detail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const fullName = (c: Client) => [c.firstName, c.lastName].filter(Boolean).join(" ");

/**
 * Clientes: everyone who commented or sent a DM is registered by the webhook. Clicking a contact opens
 * its card to edit name, surname, WhatsApp and extra fields; the AI agent uses that data too.
 */
export default function ClientsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [platform, setPlatform] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const autoImported = useRef(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["clients"],
    enabled: !!user,
    queryFn: () => api<{ clients: Client[] }>("/api/clients"),
  });
  const clients = useMemo(() => data?.clients ?? [], [data]);

  async function importPast(manual: boolean) {
    setImporting(true);
    try {
      const r = await api<{ imported: number }>("/api/clients/import", { method: "POST" });
      await qc.invalidateQueries({ queryKey: ["clients"] });
      if (manual) toast.success(`${r.imported} contactos actualizados desde el inbox`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setImporting(false);
    }
  }

  // First visit: bring in the people who wrote before this page existed.
  useEffect(() => {
    if (!data || data.clients.length || autoImported.current) return;
    autoImported.current = true;
    importPast(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return clients
      .filter((c) => platform === "all" || c.platform === platform)
      .filter(
        (c) =>
          !term ||
          [c.displayName, c.username, c.firstName, c.lastName, c.whatsapp, c.email].some((v) => v?.toLowerCase().includes(term)),
      );
  }, [clients, q, platform]);
  const selected = clients.find((c) => c.id === selectedId) ?? null;
  const usedPlatforms = PLATFORMS.filter((p) => clients.some((c) => c.platform === p.id));

  return (
    <div className="flex h-[calc(100dvh-7rem)] flex-col gap-3 md:h-[calc(100dvh-3rem)]">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-semibold">
          Clientes {clients.length > 0 && <span className="text-base font-normal text-muted-foreground">· {clients.length}</span>}
        </h1>
        <Button variant="outline" size="sm" disabled={importing} onClick={() => importPast(true)}>
          <Download /> {importing ? "Importando…" : "Importar del inbox"}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(280px,380px)_minmax(0,1fr)]">
        <section className={cn("min-h-0 flex-col overflow-hidden rounded-xl border", selected ? "hidden lg:flex" : "flex")}>
          <div className="flex gap-2 border-b p-2">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-8" placeholder="Buscar nombre, usuario, WhatsApp…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <select
              className="h-8 rounded-lg border bg-background px-2 text-sm"
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              aria-label="Filtrar por red"
            >
              <option value="all">Todas</option>
              {usedPlatforms.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
            {(isLoading || (importing && !clients.length)) && <li className="p-2 text-sm text-muted-foreground">Cargando…</li>}
            {!isLoading && !importing && !visible.length && (
              <li className="p-2 text-sm text-muted-foreground">
                {clients.length ? "Ningún cliente coincide con la búsqueda." : "Aún no hay clientes. Aparecerán cuando alguien comente o te escriba."}
              </li>
            )}
            {visible.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => setSelectedId(c.id)}
                  className={cn("flex w-full items-center gap-2 rounded-lg p-2 text-left hover:bg-muted", c.id === selectedId && "bg-muted")}
                >
                  <Avatar name={c.displayName || "?"} picture={c.picture} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1">
                      <span className="truncate text-sm font-medium">{fullName(c) || c.displayName || "Sin nombre"}</span>
                      {c.whatsapp && <Phone className="size-3 shrink-0 text-emerald-600" aria-label="Tiene WhatsApp" />}
                      <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                        {c.lastContactAt ? formatDistanceToNow(new Date(c.lastContactAt), { locale: es }) : ""}
                      </span>
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {platformName(c.platform)}
                      {fullName(c) && c.displayName ? ` · ${c.displayName}` : ""} · {c.lastMessage}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className={cn("min-h-0 flex-col overflow-hidden rounded-xl border", selected ? "flex" : "hidden lg:flex")}>
          <h2 className="flex items-center gap-1 border-b px-3 py-2 text-sm font-semibold">
            <Button variant="ghost" size="icon-xs" className="lg:hidden" aria-label="Volver" onClick={() => setSelectedId(null)}>
              <ArrowLeft />
            </Button>
            Ficha del cliente
          </h2>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {selected ? (
              <ClientDetail key={selected.id} client={selected} />
            ) : (
              <p className="text-sm text-muted-foreground">Selecciona un cliente para ver y editar sus datos.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
