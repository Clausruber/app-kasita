"use client";

import { useEffect, useState } from "react";
import { CalendarCheck, CheckCircle2, Clock, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export type PublishJob = {
  publishNow: boolean;
  networks: string[]; // "Instagram", "Facebook"…
  photosWithLogo: number; // still images that get the logo burned in on the server
  scheduledFor: Date | null;
};
export type PublishResult = PublishJob & { status: string };

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`);
const when = (d: Date) =>
  d.toLocaleString("es-MX", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Blocking modal while the post is sent: says what the server is doing and for how long. */
export function PublishingDialog({ job: open }: { job: PublishJob | null }) {
  const [seconds, setSeconds] = useState(0);
  // Keep the last job on screen while the closing animation runs.
  const [last, setLast] = useState<PublishJob | null>(open);
  if (open && open !== last) setLast(open);
  const job = open ?? last;
  useEffect(() => {
    if (!open) return;
    const started = Date.now();
    const t = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => {
      clearInterval(t);
      setSeconds(0);
    };
  }, [open]);

  const steps = job
    ? [
        ...(job.photosWithLogo ? [`Poniendo el logo a ${job.photosWithLogo === 1 ? "1 foto" : `${job.photosWithLogo} fotos`}`] : []),
        job.publishNow ? `Enviando a ${list(job.networks)}` : `Programando en ${list(job.networks)}`,
      ]
    : [];

  return (
    // Not dismissible: closing it would not stop the request.
    <Dialog open={!!open} disablePointerDismissal onOpenChange={() => {}}>
      <DialogContent showCloseButton={false}>
        <DialogHeader className="items-center text-center">
          <Loader2 className="size-10 animate-spin text-primary" />
          <DialogTitle>{job?.publishNow ? "Publicando…" : "Programando…"}</DialogTitle>
          <DialogDescription>No cierres ni recargues esta página.</DialogDescription>
        </DialogHeader>
        <ul className="space-y-1.5 text-sm">
          {steps.map((s) => (
            <li key={s} className="flex items-center gap-2">
              <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> {s}
            </li>
          ))}
        </ul>
        <p className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
          <Clock className="size-3" /> {seconds} s
        </p>
      </DialogContent>
    </Dialog>
  );
}

/** Shown once the post is accepted: published, still processing on the networks, or scheduled. */
export function PublishedDialog({ result, onViewPosts, onNewPost }: { result: PublishResult | null; onViewPosts: () => void; onNewPost: () => void }) {
  const processing = !!result?.publishNow && result.status !== "published";
  return (
    <Dialog open={!!result} onOpenChange={(o) => !o && onNewPost()}>
      <DialogContent>
        {result && (
          <>
            <DialogHeader className="items-center text-center">
              {result.publishNow ? <CheckCircle2 className="size-12 text-emerald-600" /> : <CalendarCheck className="size-12 text-emerald-600" />}
              <DialogTitle className="text-lg">{result.publishNow ? "¡Publicado!" : "¡Post programado!"}</DialogTitle>
              <DialogDescription>
                {result.publishNow
                  ? `Tu publicación se envió a ${list(result.networks)}.`
                  : `Se publicará en ${list(result.networks)} el ${result.scheduledFor ? when(result.scheduledFor) : "día elegido"}.`}
                {processing && " Las redes pueden tardar unos minutos en mostrarla."}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={onNewPost}>
                Crear otra
              </Button>
              <Button onClick={onViewPosts}>Ver publicaciones</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
