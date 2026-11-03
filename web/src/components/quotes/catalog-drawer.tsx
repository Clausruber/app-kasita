"use client";

import { useState } from "react";
import { toast } from "sonner";
import { BookOpen, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { QuoteBuilder, type QuotePrefill, type QuoteRow } from "@/components/quotes/quote-builder";
import { QuoteLinkActions, quoteMessage, quoteUrl } from "@/components/quotes/quote-links";

export { useQuoteDefaults } from "@/components/quotes/quote-builder";
export type CatalogPrefill = QuotePrefill;

/**
 * Right-side drawer: search cars, pick up to 5, optional financing / trade-in, and generate the
 * quote link. `mode="insert"` (inbox) puts the link in the message without sending it;
 * `mode="share"` shows the link with copy / open / PDF / WhatsApp.
 */
export function CatalogDrawer({
  open,
  onOpenChange,
  mode,
  prefill,
  onInsertLink,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  mode: "insert" | "share";
  prefill?: CatalogPrefill;
  onInsertLink?: (text: string, row: QuoteRow) => void;
}) {
  const [created, setCreated] = useState<QuoteRow | null>(null);

  function done(row: QuoteRow) {
    if (mode === "insert") {
      onInsertLink?.(quoteMessage(row), row);
      toast.success(`${row.folio}: el link quedó en el mensaje; revísalo y envíalo`);
      onOpenChange(false);
    } else setCreated(row);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <BookOpen className="size-4" /> Cotización
          </SheetTitle>
          <SheetDescription>Elige hasta 5 autos; se genera un link con fotos, datos y simulador de financiamiento.</SheetDescription>
        </SheetHeader>
        {created ? (
          <div className="space-y-4 px-4 py-6">
            <p className="flex items-center gap-2 text-sm font-medium">
              <CheckCircle2 className="size-5 text-emerald-600" /> {created.folio} lista
            </p>
            <p className="rounded-lg bg-muted px-3 py-2 font-mono text-xs break-all">{quoteUrl(created)}</p>
            <QuoteLinkActions row={created} labels />
            <Button variant="ghost" onClick={() => setCreated(null)}>
              Hacer otra
            </Button>
          </div>
        ) : (
          <QuoteBuilder variant="compact" prefill={prefill} enabled={open} actionLabel={mode === "insert" ? "Generar link" : "Generar cotización"} onCreated={done} onCancel={() => onOpenChange(false)} />
        )}
      </SheetContent>
    </Sheet>
  );
}

/** "Cotizar" button that opens the drawer (vehicle sheet, client and pipeline). */
export function QuoteButton({ prefill, size = "sm", variant = "outline", label = "Cotizar" }: { prefill?: CatalogPrefill; size?: "sm" | "default"; variant?: "outline" | "ghost" | "default"; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant={variant} onClick={() => setOpen(true)}>
        <BookOpen /> {label}
      </Button>
      {open && <CatalogDrawer open onOpenChange={setOpen} mode="share" prefill={prefill} />}
    </>
  );
}
