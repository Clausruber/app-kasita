"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, FileText, ImagePlus } from "lucide-react";
import { api, uploadMedia } from "@/lib/api";
import { WeeklyHours, type Weekly } from "@/components/shared/weekly-hours";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Address = { street: string; number: string; complement: string; district: string; city: string; state: string; postalCode: string; country: string };
type Company = {
  name: string;
  legalName: string;
  taxId: string;
  description: string;
  logoUrl: string;
  address: Address;
  phone: string;
  whatsapp: string;
  email: string;
  website: string;
  timezone: string;
  hours: Weekly;
  hoursNote: string;
};

const blank = (): Company => ({
  name: "",
  legalName: "",
  taxId: "",
  description: "",
  logoUrl: "",
  address: { street: "", number: "", complement: "", district: "", city: "", state: "", postalCode: "", country: "" },
  phone: "",
  whatsapp: "",
  email: "",
  website: "",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  hours: { mon: [{ start: "09:00", end: "18:00" }], tue: [{ start: "09:00", end: "18:00" }], wed: [{ start: "09:00", end: "18:00" }], thu: [{ start: "09:00", end: "18:00" }], fri: [{ start: "09:00", end: "18:00" }], sat: [], sun: [] },
  hoursNote: "",
});

const ADDRESS: { key: keyof Address; label: string; span?: boolean }[] = [
  { key: "street", label: "Calle / avenida", span: true },
  { key: "number", label: "Número" },
  { key: "complement", label: "Complemento" },
  { key: "district", label: "Barrio" },
  { key: "postalCode", label: "Código postal" },
  { key: "city", label: "Ciudad" },
  { key: "state", label: "Estado / provincia" },
  { key: "country", label: "País" },
];

function CompanyForm({ initial }: { initial: Company }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const logoInput = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Company>(k: K, v: Company[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setAddr = (k: keyof Address, v: string) => setForm((f) => ({ ...f, address: { ...f.address, [k]: v } }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  async function uploadLogo(f?: File) {
    if (!f) return;
    if (!f.type.startsWith("image/")) return toast.error("El logo debe ser una imagen");
    setUploading(true);
    try {
      set("logoUrl", (await uploadMedia(f)).url);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const r = await api<{ company: Company; markdown: string; manual: "updated" | "stale" }>("/api/settings/company", { method: "PUT", body: form });
      qc.setQueryData(["company"], { company: r.company });
      qc.invalidateQueries({ queryKey: ["ai-knowledge"] });
      setMarkdown(r.markdown);
      toast.success(
        r.manual === "updated" ? "Empresa guardada y manual del agente actualizado" : "Empresa guardada. El agente ya usa estos datos; regenera el manual cuando la IA esté configurada.",
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const field = (id: string, label: string, k: "name" | "legalName" | "taxId" | "phone" | "whatsapp" | "email" | "website" | "timezone", props: React.ComponentProps<typeof Input> = {}) => (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={form[k]} onChange={(e) => set(k, e.target.value)} {...props} />
    </div>
  );

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-center gap-3">
          {form.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={form.logoUrl} alt="Logo" className="size-20 rounded-xl border object-contain p-1" />
          ) : (
            <div className="flex size-20 items-center justify-center rounded-xl border border-dashed text-muted-foreground">
              <Building2 className="size-8" />
            </div>
          )}
          <input ref={logoInput} type="file" accept="image/*" hidden onChange={(e) => (uploadLogo(e.target.files?.[0]), (e.target.value = ""))} />
          <div className="space-y-1">
            <Button variant="outline" size="sm" disabled={uploading} onClick={() => logoInput.current?.click()}>
              <ImagePlus /> {uploading ? "Subiendo…" : form.logoUrl ? "Cambiar logo" : "Subir logo"}
            </Button>
            {form.logoUrl && (
              <Button variant="ghost" size="sm" onClick={() => set("logoUrl", "")}>
                Quitar
              </Button>
            )}
            <p className="text-xs text-muted-foreground">PNG o JPG, cuadrado si es posible.</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {field("co-name", "Nombre comercial", "name")}
          {field("co-legal", "Razón social", "legalName")}
          {field("co-tax", "Identificación fiscal (CNPJ, NIF, RUC…)", "taxId")}
          {field("co-web", "Web", "website", { placeholder: "https://…" })}
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="co-desc">Descripción</Label>
            <Textarea id="co-desc" rows={3} placeholder="A qué se dedica la empresa…" value={form.description} onChange={(e) => set("description", e.target.value)} />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Dirección</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {ADDRESS.map((a) => (
            <div key={a.key} className={a.span ? "space-y-1 sm:col-span-2" : "space-y-1"}>
              <Label htmlFor={`co-${a.key}`}>{a.label}</Label>
              <Input id={`co-${a.key}`} value={form.address[a.key]} onChange={(e) => setAddr(a.key, e.target.value)} />
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Contacto</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          {field("co-phone", "Teléfono", "phone", { type: "tel" })}
          {field("co-wa", "WhatsApp", "whatsapp", { type: "tel", placeholder: "+5511987654321" })}
          {field("co-email", "Email", "email", { type: "email" })}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <h3 className="mr-auto text-sm font-semibold">Horario de funcionamiento</h3>
          <div className="w-56">{field("co-tz", "Zona horaria", "timezone")}</div>
        </div>
        <WeeklyHours value={form.hours} onChange={(h) => set("hours", h)} />
        <div className="space-y-1">
          <Label htmlFor="co-hnote">Observaciones del horario</Label>
          <Input id="co-hnote" placeholder="Festivos cerrado, horario de verano…" value={form.hoursNote} onChange={(e) => set("hoursNote", e.target.value)} />
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={!dirty || saving || uploading || !form.name.trim()} onClick={save}>
          {saving ? "Guardando y generando…" : "Guardar"}
        </Button>
        <p className="text-xs text-muted-foreground">Al guardar se genera un documento Markdown con estos datos para el agente IA.</p>
      </div>

      {markdown && (
        <details className="rounded-lg border p-3" open>
          <summary className="flex cursor-pointer items-center gap-1.5 text-sm font-medium">
            <FileText className="size-4" /> Documento generado para el agente
          </summary>
          <pre className="mt-2 max-h-80 overflow-auto rounded bg-muted p-3 text-xs whitespace-pre-wrap">{markdown}</pre>
        </details>
      )}
    </div>
  );
}

/** Ajustes → Empresa: company data, logo and opening hours; saved as Markdown knowledge for the agent. */
export function CompanyCard() {
  const { data, isLoading, error } = useQuery({ queryKey: ["company"], queryFn: () => api<{ company: Company | null }>("/api/settings/company") });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Empresa</CardTitle>
        <CardDescription>Datos completos de la empresa. El agente IA los usa para responder dirección, contacto y horario.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
        {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
        {data && (
          <CompanyForm
            key={JSON.stringify(data.company)}
            initial={data.company ? { ...blank(), ...data.company, address: { ...blank().address, ...data.company.address } } : blank()}
          />
        )}
      </CardContent>
    </Card>
  );
}
