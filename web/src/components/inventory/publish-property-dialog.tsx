"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Megaphone, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import type { Property } from "@/lib/types";
import { useComposeStore } from "@/stores/compose-store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// Instagram carousels take at most 10 images.
const MAX_MEDIA = 10;

/** Picks photos, writes the copy with AI and opens the post composer prefilled. */
export function PublishPropertyDialog({ property }: { property: Property }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [caption, setCaption] = useState("");
  const [tone, setTone] = useState("");
  const [busy, setBusy] = useState(false);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) setPicked(property.photos.slice(0, MAX_MEDIA).map((p) => p.path));
  }

  const toggle = (path: string) =>
    setPicked((p) => (p.includes(path) ? p.filter((x) => x !== path) : p.length >= MAX_MEDIA ? p : [...p, path]));

  async function generate() {
    setBusy(true);
    try {
      const r = await api<{ caption: string }>(`/api/properties/${property.id}/caption`, { method: "POST", body: { tone } });
      setCaption(r.caption);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function openComposer() {
    const s = useComposeStore.getState();
    s.reset();
    s.setContent(caption);
    // Keep the property's photo order (cover first).
    for (const p of property.photos.filter((x) => picked.includes(x.path)))
      s.addMedia({ url: p.url, type: "image", name: p.path.split("/").pop() });
    router.push("/dashboard/posts/new");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Megaphone /> Publicar en redes
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Publicar {property.title}</DialogTitle>
          <DialogDescription>Elige hasta {MAX_MEDIA} fotos y genera el texto; después eliges redes y horario en el compositor.</DialogDescription>
        </DialogHeader>

        {property.photos.length ? (
          <ul className="grid max-h-56 grid-cols-4 gap-1.5 overflow-y-auto sm:grid-cols-6">
            {property.photos.map((p) => {
              const on = picked.includes(p.path);
              return (
                <li key={p.path}>
                  <button
                    type="button"
                    onClick={() => toggle(p.path)}
                    className={cn("relative block aspect-square w-full overflow-hidden rounded-md ring-2", on ? "ring-primary" : "opacity-50 ring-transparent")}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt="" className="size-full object-cover" />
                    {on && (
                      <span className="absolute top-0.5 right-0.5 rounded-full bg-primary p-0.5 text-primary-foreground">
                        <Check className="size-3" />
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">Esta propiedad no tiene fotos; agrégalas antes de publicar.</p>
        )}

        <div className="space-y-1">
          <Label htmlFor="pub-tone">Indicación para la IA (opcional)</Label>
          <div className="flex gap-2">
            <Input id="pub-tone" placeholder="p. ej. resalta que es ideal para familia" value={tone} onChange={(e) => setTone(e.target.value)} />
            <Button variant="secondary" disabled={busy} onClick={generate}>
              <Sparkles /> {busy ? "Escribiendo…" : caption ? "Regenerar" : "Generar texto"}
            </Button>
          </div>
        </div>
        <Textarea rows={9} placeholder="El texto de la publicación aparecerá aquí; puedes editarlo." value={caption} onChange={(e) => setCaption(e.target.value)} />

        <DialogFooter>
          <Button disabled={!picked.length || !caption.trim()} onClick={openComposer}>
            Continuar al compositor ({picked.length} foto{picked.length === 1 ? "" : "s"})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
