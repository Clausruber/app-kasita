"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { ImageIcon, ImagePlus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { uploadPostLogo } from "@/lib/logo-upload";
import { LOGO_POSITIONS, MARGIN_RANGE, OPACITY_RANGE, POSITION_LABEL, SIZE_RANGE, type PostImageSettings } from "@/lib/watermark";
import { useCan, useWorkspaceUid } from "@/hooks/use-me";
import { usePostImages, useSetPostImages, type PostImages } from "@/hooks/use-post-images";
import { useProperties } from "@/hooks/use-properties";
import { WatermarkedImage } from "@/components/shared/watermarked-image";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// Neutral stand-in photo when the inventory has no pictures yet.
const SAMPLE =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9cc3e6"/><stop offset=".62" stop-color="#e8eef4"/><stop offset=".62" stop-color="#8a8f96"/><stop offset="1" stop-color="#5d6268"/></linearGradient></defs><rect width="1200" height="800" fill="url(#g)"/><path d="M250 520 q20-110 160-130 l120-80 q60-30 160-30 h120 q90 0 150 70 l70 45 q90 15 110 80 v45 h-890z" fill="#1f2937"/><circle cx="410" cy="565" r="62" fill="#111"/><circle cx="410" cy="565" r="28" fill="#9ca3af"/><circle cx="890" cy="565" r="62" fill="#111"/><circle cx="890" cy="565" r="28" fill="#9ca3af"/></svg>',
  );

type Form = Omit<PostImageSettings, "logoUrl"> & { ownLogo: string };

const formOf = (d: PostImages): Form => ({
  ownLogo: d.logoSource === "own" ? d.logoUrl : "",
  position: d.position,
  sizePct: d.sizePct,
  opacity: d.opacity,
  marginPct: d.marginPct,
  defaultOn: d.defaultOn,
});

function Slider({ id, label, value, range, unit, onChange }: { id: string; label: string; value: number; range: readonly [number, number]; unit: string; onChange: (v: number) => void }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{label}</Label>
        <span className="text-sm tabular-nums text-muted-foreground">
          {value}
          {unit}
        </span>
      </div>
      <input id={id} type="range" min={range[0]} max={range[1]} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-primary" />
    </div>
  );
}

/** Ajustes → Imágenes: the logo burnt into post photos, its position, size and transparency. */
export function ImagesCard() {
  const ws = useWorkspaceUid();
  const can = useCan();
  const saved = usePostImages();
  const putSaved = useSetPostImages();
  const cover = useProperties(can("inventory")).data?.properties.find((v) => v.photos[0])?.photos[0]?.url;
  const [draft, setDraft] = useState<Form | null>(null);
  const form = draft ?? (saved.data ? formOf(saved.data) : null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  if (!form || !saved.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Imágenes</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">{saved.error ? (saved.error as Error).message : "Cargando…"}</CardContent>
      </Card>
    );
  }

  const companyLogo = saved.data.companyLogoUrl;
  const logoUrl = form.ownLogo || companyLogo;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setDraft({ ...form, [k]: v });

  async function upload(f?: File) {
    if (!f || !ws) return;
    setUploading(true);
    try {
      set("ownLogo", await uploadPostLogo(ws, f));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      const { ownLogo, ...rest } = form;
      putSaved(await api<PostImages>("/api/settings/images", { method: "PUT", body: { ...rest, logoUrl: ownLogo } }));
      setDraft(null);
      toast.success("Ajustes de imágenes guardados");
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
          <ImageIcon className="size-5" /> Logo en las publicaciones
        </CardTitle>
        <CardDescription>
          Al publicar, las fotos llevan tu logo en esta posición. Se agrega a una copia: las fotos originales de la propiedad no cambian.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <div className="space-y-5">
          <section className="space-y-2">
            <Label>Logo</Label>
            <div className="flex items-center gap-3">
              <div className="flex size-20 shrink-0 items-center justify-center rounded-xl border bg-[repeating-conic-gradient(#e5e7eb_0_25%,transparent_0_50%)] bg-[length:16px_16px] p-1">
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt="Logo" className="max-h-full max-w-full object-contain" />
                ) : (
                  <ImageIcon className="size-6 text-muted-foreground" />
                )}
              </div>
              <div className="space-y-1.5">
                <input ref={fileInput} type="file" accept="image/png,image/webp,image/svg+xml,image/jpeg" hidden onChange={(e) => (upload(e.target.files?.[0]), (e.target.value = ""))} />
                <Button variant="outline" size="sm" disabled={uploading} onClick={() => fileInput.current?.click()}>
                  <ImagePlus /> {uploading ? "Subiendo…" : form.ownLogo ? "Cambiar logo" : "Subir logo"}
                </Button>
                {form.ownLogo && (
                  <Button variant="ghost" size="sm" onClick={() => set("ownLogo", "")}>
                    <Trash2 /> {companyLogo ? "Usar el logo de Empresa" : "Quitar"}
                  </Button>
                )}
                <p className="text-xs text-muted-foreground">
                  {form.ownLogo ? "Logo propio para los posts." : companyLogo ? "Usando el logo de Ajustes → Empresa." : "Sin logo todavía."} Recomendado: PNG con fondo transparente.
                </p>
              </div>
            </div>
          </section>

          <section className="space-y-2">
            <Label>Posición</Label>
            <div className="grid w-36 grid-cols-3 gap-1.5">
              {LOGO_POSITIONS.map((p) => (
                <button
                  key={p}
                  type="button"
                  title={POSITION_LABEL[p]}
                  aria-label={POSITION_LABEL[p]}
                  aria-pressed={form.position === p}
                  onClick={() => set("position", p)}
                  className={cn("flex aspect-square items-center justify-center rounded-md border", form.position === p ? "border-primary bg-primary/10" : "hover:bg-muted")}
                >
                  <span className={cn("size-2.5 rounded-sm", form.position === p ? "bg-primary" : "bg-muted-foreground/40")} />
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{POSITION_LABEL[form.position]}</p>
          </section>

          <Slider id="img-size" label="Tamaño" value={form.sizePct} range={SIZE_RANGE} unit="% del ancho" onChange={(v) => set("sizePct", v)} />
          <Slider id="img-opacity" label="Opacidad" value={form.opacity} range={OPACITY_RANGE} unit="%" onChange={(v) => set("opacity", v)} />
          <Slider id="img-margin" label="Margen al borde" value={form.marginPct} range={MARGIN_RANGE} unit="%" onChange={(v) => set("marginPct", v)} />

          <label className="flex items-start gap-2 text-sm">
            <Checkbox className="mt-0.5" checked={form.defaultOn} onCheckedChange={(c) => set("defaultOn", c === true)} />
            <span>
              Activar el logo por defecto al crear un post
              <span className="block text-xs text-muted-foreground">En cada post puedes desactivarlo.</span>
            </span>
          </label>

          <div className="flex justify-end gap-2 border-t pt-4">
            {draft && (
              <Button variant="ghost" onClick={() => setDraft(null)}>
                Descartar
              </Button>
            )}
            <Button disabled={saving || !draft} onClick={save}>
              {saving ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        </div>

        <section className="space-y-2">
          <Label>Vista previa</Label>
          <WatermarkedImage
            src={cover ?? SAMPLE}
            alt="Vista previa"
            className="rounded-xl border"
            logo={logoUrl ? { ...form, logoUrl } : null}
          />
          <p className="text-xs text-muted-foreground">
            {cover ? "Portada de una de tus propiedades." : "Imagen de ejemplo."} El logo se graba igual en cada foto, sea horizontal o vertical.
          </p>
        </section>
      </CardContent>
    </Card>
  );
}
