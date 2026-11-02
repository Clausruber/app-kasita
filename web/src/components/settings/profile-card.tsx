"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera } from "lucide-react";
import { api, uploadMedia } from "@/lib/api";
import { auth } from "@/lib/firebase/client";
import { Avatar } from "@/components/inbox/commenter-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Profile = { firstName: string; lastName: string; phone: string; jobTitle: string; photoURL: string };
type ProfileData = { profile: Profile; email: string | null; role: string; nameEditable: boolean };

function ProfileForm({ initial, data }: { initial: Profile; data: ProfileData }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  async function upload(f?: File) {
    if (!f) return;
    if (!f.type.startsWith("image/")) return toast.error("Elige una imagen");
    setUploading(true);
    try {
      set("photoURL", (await uploadMedia(f)).url);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const r = await api<{ profile: Profile }>("/api/settings/profile", { method: "PUT", body: form });
      qc.setQueryData(["profile"], { ...data, profile: r.profile });
      await auth.currentUser?.reload(); // name/photo are also on the Auth user
      toast.success("Perfil guardado");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const name = [form.firstName, form.lastName].filter(Boolean).join(" ") || auth.currentUser?.email || "?";
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Avatar name={name} picture={form.photoURL || null} className="size-16 text-xl" />
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => (upload(e.target.files?.[0]), (e.target.value = ""))} />
        <Button variant="outline" size="sm" disabled={uploading} onClick={() => file.current?.click()}>
          <Camera /> {uploading ? "Subiendo…" : "Cambiar foto"}
        </Button>
        {form.photoURL && (
          <Button variant="ghost" size="sm" onClick={() => set("photoURL", "")}>
            Quitar
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        {data.email} · {data.role}
        {!data.nameEditable && " · el nombre y el email los gestiona el administrador"}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="pf-first">Nombre</Label>
          <Input id="pf-first" value={form.firstName} disabled={!data.nameEditable} onChange={(e) => set("firstName", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pf-last">Apellidos</Label>
          <Input id="pf-last" value={form.lastName} disabled={!data.nameEditable} onChange={(e) => set("lastName", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pf-phone">{data.nameEditable ? "Teléfono" : "WhatsApp"}</Label>
          <Input id="pf-phone" type="tel" placeholder="+5511987654321" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pf-job">Cargo</Label>
          <Input id="pf-job" placeholder="Dueña, gerente…" value={form.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} />
        </div>
      </div>
      <Button disabled={!dirty || saving || uploading || !form.firstName.trim()} onClick={save}>
        {saving ? "Guardando…" : "Guardar"}
      </Button>
    </div>
  );
}

/** Ajustes → Perfil: the signed-in user's own data (name, surname, photo, phone). */
export function ProfileCard() {
  const { data, isLoading, error } = useQuery({ queryKey: ["profile"], queryFn: () => api<ProfileData>("/api/settings/profile") });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Perfil</CardTitle>
        <CardDescription>Tus datos personales.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
        {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
        {data && <ProfileForm key={JSON.stringify(data.profile)} initial={data.profile} data={data} />}
      </CardContent>
    </Card>
  );
}
