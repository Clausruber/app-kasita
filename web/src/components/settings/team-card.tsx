"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";
import { Copy, Link2, MessageCircle, Trash2, UserPlus } from "lucide-react";
import { api } from "@/lib/api";
import { PERMISSIONS, ROLE_PRESETS, TEAM_ROLES, type TeamRole, normalisePerms, roleLabel } from "@/lib/permissions";
import type { Availability } from "@/lib/types";
import { Avatar } from "@/components/inbox/commenter-list";
import { AvailabilityEditor } from "@/components/settings/availability-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type Member = {
  id: string;
  uid: string | null;
  firstName: string;
  lastName: string;
  email: string;
  whatsapp: string;
  photoURL: string | null;
  role: TeamRole;
  perms: string[];
  status: "invited" | "active" | "inactive";
  inviteExpiresAt: string | null;
  createdAt: string | null;
  acceptedAt: string | null;
  availability: Availability | null;
};
type Invite = { url: string; expiresAt: string };

const STATUS: Record<Member["status"], { label: string; className: string }> = {
  invited: { label: "Invitado", className: "bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  active: { label: "Activo", className: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300" },
  inactive: { label: "Inactivo", className: "bg-muted text-muted-foreground" },
};
const fullName = (m: Pick<Member, "firstName" | "lastName">) => [m.firstName, m.lastName].filter(Boolean).join(" ");
const select = "h-8 w-full rounded-lg border bg-background px-2 text-sm";

/** Copy / WhatsApp share of an invitation link. */
function InviteLink({ invite, member }: { invite: Invite; member: Pick<Member, "firstName" | "whatsapp"> }) {
  const text = `Hola ${member.firstName}, te invito a unirte a nuestro equipo. Crea tu acceso aquí: ${invite.url}`;
  const wa = member.whatsapp.replace(/\D/g, "");
  return (
    <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <Link2 className="size-4" /> Enlace de invitación
      </p>
      <Input readOnly value={invite.url} onFocus={(e) => e.target.select()} className="font-mono text-xs" />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => navigator.clipboard.writeText(invite.url).then(() => toast.success("Enlace copiado"))}
        >
          <Copy /> Copiar
        </Button>
        <a
          className="inline-flex h-7 items-center gap-1 rounded-lg border px-2.5 text-[0.8rem] hover:bg-muted"
          href={`https://wa.me/${wa}?text=${encodeURIComponent(text)}`}
          target="_blank"
          rel="noreferrer"
        >
          <MessageCircle className="size-3.5" /> Enviar por WhatsApp
        </a>
      </div>
      <p className="text-xs text-muted-foreground">
        Válido hasta el {format(new Date(invite.expiresAt), "d MMM yyyy", { locale: es })}. Solo se muestra ahora: si lo pierdes, genera uno nuevo.
      </p>
    </div>
  );
}

function InviteDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ firstName: "", lastName: "", whatsapp: "", email: "", role: "team" as TeamRole });
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<{ member: Member; invite: Invite } | null>(null);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function create() {
    setSaving(true);
    try {
      const r = await api<{ member: Member; invite: Invite }>("/api/team", { method: "POST", body: form });
      setCreated(r);
      qc.invalidateQueries({ queryKey: ["team"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{created ? "Invitación creada" : "Invitar usuario"}</DialogTitle>
          <DialogDescription>
            {created
              ? `Envía este enlace a ${fullName(created.member)}. Al abrirlo verá su nombre y email ya rellenados y solo tendrá que crear su contraseña.`
              : "Se genera un enlace de registro personal. Nombre, apellidos y email no se podrán cambiar al registrarse."}
          </DialogDescription>
        </DialogHeader>
        {created ? (
          <InviteLink invite={created.invite} member={created.member} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="tm-first">Nombre</Label>
              <Input id="tm-first" value={form.firstName} onChange={(e) => set("firstName", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="tm-last">Apellidos</Label>
              <Input id="tm-last" value={form.lastName} onChange={(e) => set("lastName", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="tm-wa">WhatsApp</Label>
              <Input id="tm-wa" type="tel" placeholder="+5511987654321" value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="tm-email">Email</Label>
              <Input id="tm-email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="tm-role">Rol</Label>
              <select id="tm-role" className={select} value={form.role} onChange={(e) => set("role", e.target.value)}>
                {TEAM_ROLES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label} — {r.description}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">Después puedes ajustar sus accesos uno a uno.</p>
            </div>
          </div>
        )}
        <DialogFooter>
          {created ? (
            <Button onClick={onClose}>Listo</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              <Button disabled={saving || !form.firstName.trim() || !form.email.trim()} onClick={create}>
                <UserPlus /> {saving ? "Creando…" : "Crear invitación"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Checkbox tree of every menu item, sub-item and settings tab. */
function AccessEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const has = (k: string) => value.includes(k);
  const toggle = (k: string, children: string[] = []) => {
    const on = !has(k);
    const next = new Set(value);
    if (on) {
      next.add(k);
      if (k.includes(".")) next.add(k.split(".")[0]); // a sub-item needs its menu
    } else [k, ...children].forEach((x) => next.delete(x));
    onChange(normalisePerms([...next]));
  };
  return (
    <div className="space-y-3">
      {PERMISSIONS.map((n) => {
        const kids = (n.children ?? []).map((c) => c.key);
        return (
          <div key={n.key} className="rounded-lg border p-2.5">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={has(n.key)} onChange={() => toggle(n.key, kids)} />
              {n.label}
            </label>
            {!!n.children?.length && (
              <div className={cn("mt-2 grid gap-1.5 pl-6 sm:grid-cols-2", !has(n.key) && "opacity-50")}>
                {n.children.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={has(c.key)} onChange={() => toggle(c.key)} />
                    {c.label}
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <p className="text-xs text-muted-foreground">Perfil siempre está disponible. Un sub-elemento solo funciona si su menú también está marcado.</p>
    </div>
  );
}

function MemberDialog({ member, onClose }: { member: Member; onClose: () => void }) {
  const qc = useQueryClient();
  const [role, setRole] = useState(member.role);
  const [perms, setPerms] = useState(member.perms);
  const [whatsapp, setWhatsapp] = useState(member.whatsapp);
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState<Invite | null>(null);
  const dirty = role !== member.role || whatsapp !== member.whatsapp || JSON.stringify(perms) !== JSON.stringify(member.perms);

  async function call<T>(fn: () => Promise<T>, ok?: string) {
    setBusy(true);
    try {
      const r = await fn();
      qc.invalidateQueries({ queryKey: ["team"] });
      if (ok) toast.success(ok);
      return r;
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const put = (body: object, ok: string) => call(() => api(`/api/team/${member.id}`, { method: "PUT", body }), ok);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Avatar name={fullName(member) || member.email} picture={member.photoURL} className="size-8" />
            {fullName(member)}
            <span className={cn("rounded px-1.5 py-0.5 text-xs font-normal", STATUS[member.status].className)}>{STATUS[member.status].label}</span>
          </DialogTitle>
          <DialogDescription>{member.email}</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="datos">
          <TabsList>
            <TabsTrigger value="datos">Datos</TabsTrigger>
            <TabsTrigger value="accesos">Accesos</TabsTrigger>
            <TabsTrigger value="horario">Horario</TabsTrigger>
          </TabsList>
          <TabsContent value="datos" className="space-y-4 pt-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Nombre y apellidos</Label>
                <Input value={fullName(member)} disabled />
              </div>
              <div className="space-y-1">
                <Label>Email</Label>
                <Input value={member.email} disabled />
              </div>
              <div className="space-y-1">
                <Label htmlFor="md-wa">WhatsApp</Label>
                <Input id="md-wa" type="tel" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="md-role">Rol</Label>
                <select
                  id="md-role"
                  className={select}
                  value={role}
                  onChange={(e) => {
                    const r = e.target.value as TeamRole;
                    setRole(r);
                    setPerms(ROLE_PRESETS[r]);
                  }}
                >
                  {TEAM_ROLES.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">Cambiar el rol aplica sus accesos por defecto.</p>
              </div>
            </div>

            {member.status === "invited" ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Aún no aceptó la invitación
                  {member.inviteExpiresAt && ` (caduca el ${format(new Date(member.inviteExpiresAt), "d MMM", { locale: es })})`}.
                </p>
                {invite ? (
                  <InviteLink invite={invite} member={{ firstName: member.firstName, whatsapp }} />
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={async () => {
                      const r = await call(() => api<{ invite: Invite }>(`/api/team/${member.id}/link`, { method: "POST" }));
                      if (r) setInvite(r.invite);
                    }}
                  >
                    <Link2 /> Generar nuevo enlace
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-1">
                <Label>Estado</Label>
                <div className="flex w-fit rounded-lg border p-0.5">
                  {(["active", "inactive"] as const).map((s) => (
                    <Button
                      key={s}
                      size="sm"
                      variant={member.status === s ? "secondary" : "ghost"}
                      disabled={busy || member.status === s}
                      onClick={() => put({ status: s }, s === "active" ? "Usuario activado" : "Usuario desactivado")}
                    >
                      {STATUS[s].label}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">Un usuario inactivo no puede entrar ni usar la app hasta que lo vuelvas a activar.</p>
              </div>
            )}
          </TabsContent>
          <TabsContent value="accesos" className="pt-2">
            <AccessEditor value={perms} onChange={setPerms} />
          </TabsContent>
          <TabsContent value="horario" className="space-y-2 pt-2">
            <p className="text-xs text-muted-foreground">Horario en que {member.firstName || "esta persona"} puede atender visitas. Se guarda aparte del botón Guardar.</p>
            <AvailabilityEditor
              value={member.availability ?? { weekly: null, blockedDates: [] }}
              saving={busy}
              onSave={(availability) => put({ availability }, "Horario guardado")}
            />
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button
            variant="ghost"
            className="mr-auto text-destructive"
            disabled={busy}
            onClick={async () => {
              if (!confirm(`¿Borrar a ${fullName(member)}? Perderá el acceso de inmediato.`)) return;
              const r = await call(() => api<{ accountDeleted: boolean }>(`/api/team/${member.id}`, { method: "DELETE" }), "Usuario borrado");
              if (r) onClose();
            }}
          >
            <Trash2 /> Borrar usuario
          </Button>
          <Button variant="outline" onClick={onClose}>
            Cerrar
          </Button>
          <Button disabled={!dirty || busy} onClick={() => put({ role, perms, whatsapp }, "Cambios guardados").then((r) => r && onClose())}>
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Ajustes → Usuarios: invite the team, set role/access per person, activate/deactivate or delete. */
export function TeamCard() {
  const { data, isLoading, error } = useQuery({ queryKey: ["team"], queryFn: () => api<{ members: Member[] }>("/api/team") });
  const [inviting, setInviting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const members = data?.members ?? [];
  const editing = members.find((m) => m.id === editingId) ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="mr-auto">Usuarios</span>
          <Button size="sm" onClick={() => setInviting(true)}>
            <UserPlus /> Invitar usuario
          </Button>
        </CardTitle>
        <CardDescription>Tu equipo entra con un enlace de invitación personal y solo ve lo que le habilites en Accesos.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
        {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
        {!isLoading && !members.length && !error && (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Aún no has invitado a nadie.</p>
        )}
        <ul className="divide-y">
          {members.map((m) => (
            <li key={m.id}>
              <button className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-muted/50" onClick={() => setEditingId(m.id)}>
                <Avatar name={fullName(m) || m.email} picture={m.photoURL} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{fullName(m)}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {m.email}
                    {m.whatsapp ? ` · ${m.whatsapp}` : ""}
                  </span>
                </span>
                <span className="hidden text-xs text-muted-foreground sm:inline">{roleLabel(m.role)}</span>
                <span className={cn("rounded px-1.5 py-0.5 text-xs", STATUS[m.status].className)}>{STATUS[m.status].label}</span>
              </button>
            </li>
          ))}
        </ul>
      </CardContent>
      {inviting && <InviteDialog onClose={() => setInviting(false)} />}
      {editing && <MemberDialog key={editing.id + editing.status} member={editing} onClose={() => setEditingId(null)} />}
    </Card>
  );
}
