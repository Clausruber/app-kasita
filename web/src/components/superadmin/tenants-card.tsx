"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";
import { ShieldCheck, Users } from "lucide-react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Status = "pending" | "active" | "disabled";
type Tenant = {
  uid: string;
  email: string | null;
  name: string | null;
  createdAt: string | null;
  lastSignIn: string | null;
  role: "superadmin" | "admin";
  status: Status;
  zernioKeyHint: string | null;
  companyName: string | null;
  whatsapp: string | null;
  webhookId: string | null;
};

const STATUS: Record<Status, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "Pendiente", variant: "secondary" },
  active: { label: "Activa", variant: "default" },
  disabled: { label: "Desactivada", variant: "destructive" },
};
const FILTERS = [
  { id: "pending", label: "Pendientes" },
  { id: "active", label: "Activas" },
  { id: "all", label: "Todas" },
] as const;

const ago = (iso: string | null) => (iso ? formatDistanceToNow(new Date(iso), { addSuffix: true, locale: es }) : "—");

function TenantRow({ t, onSaved }: { t: Tenant; onSaved: (t: Tenant) => void }) {
  const [key, setKey] = useState("");
  const [editing, setEditing] = useState(t.status === "pending");
  const [busy, setBusy] = useState(false);

  async function update(body: { zernioKey?: string; status?: Status }, ok: string) {
    setBusy(true);
    try {
      onSaved(await api<Tenant>(`/api/admin/tenants/${t.uid}`, { method: "PUT", body }));
      setKey("");
      setEditing(false);
      toast.success(ok);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-sm font-medium">
            {t.role === "superadmin" && <ShieldCheck className="size-4 text-violet-600" aria-label="SuperAdmin" />}
            {t.email ?? t.uid}
            {t.name && <span className="font-normal text-muted-foreground">· {t.name}</span>}
          </p>
          {(t.companyName || t.whatsapp) && (
            <p className="truncate text-xs">
              {t.companyName}
              {t.whatsapp && <span className="text-muted-foreground"> · WhatsApp {t.whatsapp}</span>}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Alta {ago(t.createdAt)} · último acceso {ago(t.lastSignIn)}
            {t.zernioKeyHint ? ` · Zernio ${t.zernioKeyHint}` : t.status === "active" ? " · sin Zernio (redes desactivadas)" : ""}
            {t.zernioKeyHint && !t.webhookId && " · sin webhook"}
          </p>
        </div>
        <Badge variant={STATUS[t.status].variant}>{STATUS[t.status].label}</Badge>
        {t.status === "active" && t.role !== "superadmin" && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => confirm(`¿Desactivar ${t.email}?`) && update({ status: "disabled" }, "Cuenta desactivada")}>
            Desactivar
          </Button>
        )}
        {t.status === "disabled" && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => update({ status: "active" }, "Cuenta reactivada")}>
            Reactivar
          </Button>
        )}
        {!editing && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(true)}>
            {t.zernioKeyHint ? "Cambiar key" : "Asignar key"}
          </Button>
        )}
      </div>

      {editing && (
        <div className="flex flex-wrap gap-2">
          <Input
            type="password"
            autoComplete="off"
            className="min-w-0 flex-1"
            placeholder={t.zernioKeyHint ? `API key de Zernio (actual ${t.zernioKeyHint})` : "API key de Zernio (sk_…)"}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          {t.status === "pending" ? (
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                key.trim()
                  ? update({ zernioKey: key.trim(), status: "active" }, "Key guardada, webhook registrado y cuenta activada")
                  : update({ status: "active" }, "Cuenta activada sin Zernio: asigna la key cuando la tengas")
              }
            >
              {busy ? "Activando…" : key.trim() || t.zernioKeyHint ? "Guardar y activar" : "Activar sin Zernio"}
            </Button>
          ) : (
            <Button size="sm" disabled={busy || !key.trim()} onClick={() => update({ zernioKey: key.trim() }, "Key actualizada y webhook registrado")}>
              {busy ? "Guardando…" : "Guardar key"}
            </Button>
          )}
          {t.status !== "pending" && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => (setEditing(false), setKey(""))}>
              Cancelar
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

/** Accounts list: activate new admins by assigning their Zernio API key. */
export function TenantsCard() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-tenants"],
    queryFn: async () => (await api<{ tenants: Tenant[] }>("/api/admin/tenants")).tenants,
  });
  const pending = data?.filter((t) => t.status === "pending").length ?? 0;
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const rows = (data ?? []).filter((t) => filter === "all" || t.status === filter);

  const onSaved = (row: Tenant) =>
    qc.setQueryData<Tenant[]>(["admin-tenants"], (old) => old?.map((t) => (t.uid === row.uid ? row : t)));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="size-5" /> Cuentas
          {pending > 0 && <Badge variant="secondary">{pending} pendiente{pending > 1 ? "s" : ""}</Badge>}
        </CardTitle>
        <CardDescription>
          Las cuentas nuevas quedan pendientes. Asígnales su API key de Zernio para activarlas: se valida la key y se
          registra automáticamente el webhook de comentarios para esa cuenta.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex rounded-lg border p-0.5 sm:w-fit">
          {FILTERS.map((f) => (
            <Button key={f.id} size="sm" variant={filter === f.id ? "secondary" : "ghost"} onClick={() => setFilter(f.id)}>
              {f.label}
            </Button>
          ))}
        </div>
        {isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
        {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
        {!isLoading && !rows.length && <p className="text-sm text-muted-foreground">No hay cuentas en esta vista.</p>}
        <ul className="divide-y">
          {rows.map((t) => (
            <TenantRow key={`${t.uid}:${t.status}:${t.zernioKeyHint}`} t={t} onSaved={onSaved} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
