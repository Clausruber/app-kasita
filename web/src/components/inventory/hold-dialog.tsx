"use client";

import { useState } from "react";
import { format, isToday, isTomorrow } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";
import { Lock, LockOpen } from "lucide-react";
import { api } from "@/lib/api";
import type { Property, PropertyHold } from "@/lib/types";
import { useCan, useMe } from "@/hooks/use-me";
import { usePutPropertyCache } from "@/hooks/use-properties";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const HOURS = [2, 4, 24, 48, 72] as const; // same options as api/properties/[id]/hold

/** "hasta 17:00", "hasta mañana 10:00", "hasta vie 7 nov 10:00". */
export function holdUntil(iso: string) {
  const d = new Date(iso);
  const time = format(d, "HH:mm");
  return isToday(d) ? `hasta ${time}` : isTomorrow(d) ? `hasta mañana ${time}` : `hasta ${format(d, "EEE d MMM", { locale: es })} ${time}`;
}

export function useIsMyHold(hold: PropertyHold | null | undefined) {
  const me = useMe().data?.sellerId;
  return !!hold && !!me && hold.byId === me;
}

/** 🔒 "Laura · hasta 17:00" (highlighted when it is yours). */
export function HoldBadge({ hold, className }: { hold: PropertyHold; className?: string }) {
  const mine = useIsMyHold(hold);
  return (
    <span
      title={hold.note || undefined}
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium",
        mine ? "bg-violet-600 text-white" : "bg-amber-500/90 text-white",
        className,
      )}
    >
      <Lock className="size-3" /> {mine ? "Tú" : hold.byName || "Bloqueado"} · {holdUntil(hold.until)}
    </span>
  );
}

/** Inline notice where the property is used (quote, closing): someone else is working it. Blocks nothing. */
export function HoldWarning({ hold }: { hold: PropertyHold | null | undefined }) {
  const mine = useIsMyHold(hold);
  if (!hold || mine) return null;
  return (
    <p className="text-[11px] text-amber-700 dark:text-amber-300">
      ⚠️ Bloqueado por {hold.byName || "otro asesor"} {holdUntil(hold.until)}
      {hold.note ? ` · ${hold.note}` : ""}
    </p>
  );
}

/** "Bloquear" / "Extender" + "Liberar" for a property (card and sheet). */
export function HoldButtons({ property, size = "sm" }: { property: Property; size?: "sm" | "xs" }) {
  const can = useCan();
  const putCache = usePutPropertyCache();
  const mine = useIsMyHold(property.hold);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!can("inventory") || !["disponible", "apartado"].includes(property.status)) return null;
  const canRelease = !!property.hold && (mine || can("inventory.edit"));

  async function release() {
    setBusy(true);
    try {
      const r = await api<{ property: Property }>(`/api/properties/${property.id}/hold`, { method: "DELETE" });
      putCache(r.property);
      toast.success("Bloqueo liberado");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="outline" size={size} onClick={() => setOpen(true)}>
        <Lock /> {mine ? "Extender" : "Bloquear"}
      </Button>
      {canRelease && (
        <Button variant="ghost" size={size} disabled={busy} onClick={release}>
          <LockOpen /> Liberar
        </Button>
      )}
      {open && <HoldDialog property={property} onClose={() => setOpen(false)} />}
    </>
  );
}

function HoldDialog({ property, onClose }: { property: Property; onClose: () => void }) {
  const putCache = usePutPropertyCache();
  const mine = useIsMyHold(property.hold);
  const [hours, setHours] = useState<(typeof HOURS)[number]>(4);
  const [note, setNote] = useState(mine ? (property.hold?.note ?? "") : "");
  const [busy, setBusy] = useState(false);
  // When the dialog opened: reference for the "vence" preview (render must stay pure).
  const [openedAt] = useState(() => Date.now());

  async function save() {
    setBusy(true);
    try {
      const r = await api<{ property: Property; previous: PropertyHold | null }>(`/api/properties/${property.id}/hold`, { method: "POST", body: { hours, note } });
      putCache(r.property);
      toast.success(r.previous ? `Bloqueado; reemplazaste el bloqueo de ${r.previous.byName}` : `Bloqueado ${r.property.hold ? holdUntil(r.property.hold.until) : ""}`);
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{mine ? "Extender bloqueo" : "Bloquear propiedad"}</DialogTitle>
          <DialogDescription>
            {property.title || property.propertyType}: avisa al equipo que la estás mostrando. No impide que otros la coticen o cierren.
          </DialogDescription>
        </DialogHeader>
        {property.hold && !mine && (
          <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
            Ya lo tiene {property.hold.byName} {holdUntil(property.hold.until)}. Si continúas, reemplazas su bloqueo.
          </p>
        )}
        <div className="space-y-1">
          <Label>Duración</Label>
          <div className="flex flex-wrap gap-1.5">
            {HOURS.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setHours(h)}
                className={cn("rounded-md border px-3 py-1.5 text-sm", hours === h ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
              >
                {h} h
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Vence {holdUntil(new Date(openedAt + hours * 3_600_000).toISOString())}. Te avisamos 1 h antes.</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="hold-note">Nota (opcional)</Label>
          <Input id="hold-note" maxLength={200} placeholder="Cliente viene a verla a las 4" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={busy} onClick={save}>
            <Lock /> {busy ? "Guardando…" : mine ? "Extender" : "Bloquear"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
