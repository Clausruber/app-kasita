"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ImagePlus, Send, CalendarClock, X } from "lucide-react";
import { api, uploadMedia } from "@/lib/api";
import { useAccounts } from "@/hooks/use-accounts";
import { useComposeStore } from "@/stores/compose-store";
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
  const [sending, setSending] = useState(false);

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
    setSending(true);
    try {
      await api("/api/posts", {
        method: "POST",
        body: {
          content: s.content,
          accountIds: s.accountIds,
          mediaItems: s.mediaItems.map(({ url, type }) => ({ url, type })),
          publishNow,
          // datetime-local has no offset; convert from the browser's local time.
          scheduledFor: publishNow ? null : new Date(s.scheduledFor).toISOString(),
          timezone: timezone(),
        },
      });
      toast.success(publishNow ? "Publicado" : "Post programado");
      s.reset();
      router.push("/dashboard/posts");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  const activeAccounts = accounts.filter((a) => a.isActive !== false);
  const canSend = !sending && !uploading && s.accountIds.length > 0 && (s.content.trim() || s.mediaItems.length);

  if (!canCreate) return <p className="text-sm text-muted-foreground">No tienes permiso para crear publicaciones.</p>;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/dashboard/posts" aria-label="Volver a publicaciones" className={buttonVariants({ variant: "ghost", size: "icon-sm" })}>
          <ArrowLeft />
        </Link>
        <h1 className="text-2xl font-semibold">Nueva publicación</h1>
      </div>

      <Card>
        <CardContent className="space-y-4">
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
            <div className="flex flex-wrap gap-2">
              {s.mediaItems.map((m) => (
                <div key={m.url} className="relative size-24 overflow-hidden rounded-lg border bg-muted">
                  {m.type === "video" ? (
                    <video src={m.url} className="size-full object-cover" muted />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.url} alt={m.name ?? ""} className="size-full object-cover" />
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
            <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()} disabled={uploading > 0}>
              <ImagePlus /> {uploading ? `Subiendo (${uploading})…` : "Añadir imagen o video"}
            </Button>
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
    </div>
  );
}
