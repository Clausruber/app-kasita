"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Building2, ImagePlus, PenLine, Send, CalendarClock, Stamp, X } from "lucide-react";
import { api, uploadMedia } from "@/lib/api";
import { useAccounts } from "@/hooks/use-accounts";
import { useComposeStore } from "@/stores/compose-store";
import { usePostImages } from "@/hooks/use-post-images";
import { PostPreview } from "@/components/posts/post-preview";
import { PropertyPicker } from "@/components/posts/property-picker";
import { WatermarkedImage } from "@/components/shared/watermarked-image";
import { PublishedDialog, PublishingDialog, type PublishJob, type PublishResult } from "@/components/posts/publish-dialogs";
import { platformName } from "@/lib/platforms";
import { Checkbox } from "@/components/ui/checkbox";
import { PlatformBadge } from "@/components/shared/platform-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useCan } from "@/hooks/use-me";

const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export default function NewPostPage() {
  const router = useRouter();
  const { data: accounts = [], isLoading } = useAccounts();
  const s = useComposeStore();
  const canCreate = useCan()("posts.create");
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [job, setJob] = useState<PublishJob | null>(null);
  const [result, setResult] = useState<PublishResult | null>(null);
  const sending = !!job;
  const images = usePostImages();
  const hasLogo = !!images.data?.logoUrl;
  // The toggle starts at the default from Ajustes → Imágenes until the user flips it.
  const withLogo = hasLogo && (s.watermark ?? images.data?.defaultOn ?? false);
  const logo = withLogo ? images.data! : null;
  const isGif = (url: string) => /\.gif(\?|$)/i.test(url);
  const hasStills = s.mediaItems.some((m) => (m.type ?? "image") === "image" && !isGif(m.url));
  const hasMoving = s.mediaItems.some((m) => m.type === "video" || m.type === "gif" || isGif(m.url));

  async function onFiles(files: FileList | null) {
    for (const file of Array.from(files ?? [])) {
      setUploading((n) => n + 1);
      try {
        s.addMedia({ ...(await uploadMedia(file)), name: file.name });
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  async function submit(publishNow: boolean) {
    if (!publishNow && !s.scheduledFor) return toast.error("Elige fecha y hora");
    const chosen = accounts.filter((a) => s.accountIds.includes(a._id));
    const current: PublishJob = {
      publishNow,
      networks: [...new Set(chosen.map((a) => platformName(a.platform)))],
      photosWithLogo: withLogo ? s.mediaItems.filter((m) => (m.type ?? "image") === "image" && !isGif(m.url)).length : 0,
      scheduledFor: publishNow ? null : new Date(s.scheduledFor),
    };
    setJob(current);
    try {
      const res = await api<{ id: string; status: string }>("/api/posts", {
        method: "POST",
        body: {
          content: s.content,
          accountIds: s.accountIds,
          mediaItems: s.mediaItems.map(({ url, type }) => ({ url, type })),
          watermark: withLogo && hasStills,
          publishNow,
          // datetime-local has no offset; convert from the browser's local time.
          scheduledFor: publishNow ? null : new Date(s.scheduledFor).toISOString(),
          timezone: timezone(),
        },
      });
      s.reset();
      setResult({ ...current, status: res.status });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setJob(null);
    }
  }

  const fromInventory = s.source === "inventario";
  const activeAccounts = accounts.filter((a) => a.isActive !== false);
  const canSend = !sending && !uploading && s.accountIds.length > 0 && (s.content.trim() || s.mediaItems.length);

  if (!canCreate) return <p className="text-sm text-muted-foreground">No tienes permiso para crear publicaciones.</p>;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PublishingDialog job={job} />
      <PublishedDialog result={result} onViewPosts={() => router.push("/dashboard/posts")} onNewPost={() => setResult(null)} />
      <div className="flex items-center gap-2">
        <Link href="/dashboard/posts" aria-label="Volver a publicaciones" className={buttonVariants({ variant: "ghost", size: "icon-sm" })}>
          <ArrowLeft />
        </Link>
        <h1 className="text-2xl font-semibold">Nueva publicación</h1>
      </div>

      <Card>
        <CardContent className="space-y-4">
          <div className="inline-flex rounded-lg border p-0.5" role="tablist" aria-label="Origen de la publicación">
            {(
              [
                ["nueva", "Nueva", PenLine],
                ["inventario", "Inventario", Building2],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={s.source === value}
                onClick={() => s.setSource(value)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1 text-sm transition-colors",
                  s.source === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                )}
              >
                <Icon className="size-4" /> {label}
              </button>
            ))}
          </div>

          {fromInventory && (
            <PropertyPicker propertyId={s.propertyId} media={s.mediaItems} onPick={s.pickProperty} onMedia={s.setMedia} />
          )}

          <div className="space-y-2">
            <Label>Publicar en</Label>
            {isLoading && <p className="text-sm text-muted-foreground">Cargando cuentas…</p>}
            {!isLoading && !activeAccounts.length && (
              <p className="text-sm text-muted-foreground">
                No tienes cuentas conectadas.{" "}
                <Link href="/dashboard/settings#redes" className="text-primary hover:underline">
                  Conecta una
                </Link>
                .
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {activeAccounts.map((a) => {
                const on = s.accountIds.includes(a._id);
                return (
                  <button
                    key={a._id}
                    type="button"
                    onClick={() => s.toggleAccount(a._id)}
                    className={cn(
                      "flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition-colors",
                      on ? "border-primary bg-primary/10" : "hover:bg-muted",
                    )}
                  >
                    <PlatformBadge platform={a.platform} />
                    <span className="text-muted-foreground">{a.username || a.displayName}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="content">Texto</Label>
            <Textarea
              id="content"
              rows={7}
              placeholder="¿Qué quieres publicar?"
              value={s.content}
              onChange={(e) => s.setContent(e.target.value)}
            />
            <p className="text-right text-xs text-muted-foreground">{s.content.length} caracteres</p>
          </div>

          <div className="space-y-2">
            {!fromInventory && (
            <div className="flex flex-wrap gap-2">
              {s.mediaItems.map((m) => (
                <div key={m.url} className="relative flex size-24 items-center overflow-hidden rounded-lg border bg-muted">
                  {m.type === "video" ? (
                    <video src={m.url} className="size-full object-cover" muted />
                  ) : (
                    <WatermarkedImage src={m.url} alt={m.name ?? ""} logo={m.type === "gif" ? null : logo} className="w-full" />
                  )}
                  <button
                    type="button"
                    aria-label="Quitar"
                    onClick={() => s.removeMedia(m.url)}
                    className="absolute top-1 right-1 rounded-full bg-background/80 p-0.5"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
            )}
            <input
              ref={fileInput}
              type="file"
              accept="image/*,video/*"
              multiple
              hidden
              onChange={(e) => {
                onFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {!fromInventory && (
                <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()} disabled={uploading > 0}>
                  <ImagePlus /> {uploading ? `Subiendo (${uploading})…` : "Añadir imagen o video"}
                </Button>
              )}
              <label className={cn("flex items-center gap-2 text-sm", !hasLogo && "text-muted-foreground")}>
                <Checkbox checked={withLogo} disabled={!hasLogo} onCheckedChange={(c) => s.setWatermark(c === true)} />
                <Stamp className="size-4" /> Agregar logo
              </label>
              {!images.isLoading && !hasLogo && (
                <Link href="/dashboard/settings#imagenes" className="text-xs text-primary hover:underline">
                  Configura tu logo en Ajustes → Imágenes
                </Link>
              )}
            </div>
            {withLogo && hasMoving && <p className="text-xs text-muted-foreground">Los videos y GIF se publican sin logo.</p>}
          </div>

          <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="when">Fecha y hora ({timezone()})</Label>
              <Input
                id="when"
                type="datetime-local"
                value={s.scheduledFor}
                onChange={(e) => s.setScheduledFor(e.target.value)}
              />
            </div>
            <div className="flex gap-2 sm:ml-auto">
              <Button variant="outline" disabled={!canSend} onClick={() => submit(true)}>
                <Send /> Publicar ahora
              </Button>
              <Button disabled={!canSend || !s.scheduledFor} onClick={() => submit(false)}>
                <CalendarClock /> Programar
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3">
          <Label>Vista previa</Label>
          <PostPreview
            accounts={activeAccounts.filter((a) => s.accountIds.includes(a._id))}
            content={s.content}
            media={s.mediaItems}
            logo={logo}
          />
        </CardContent>
      </Card>
    </div>
  );
}
