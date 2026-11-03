"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Copy, Download, ExternalLink, MessageCircle } from "lucide-react";
import { apiDownload } from "@/lib/api";
import { Button } from "@/components/ui/button";
import type { QuoteRow } from "@/components/quotes/quote-builder";

/** Public URL of a quote on this deployment (local, preview or production alike). */
export const quoteUrl = (row: Pick<QuoteRow, "path">) => (row.path ? `${window.location.origin}${row.path}` : "");

export const quoteMessage = (row: Pick<QuoteRow, "folio" | "clientName" | "path">) =>
  `Hola${row.clientName ? ` ${row.clientName.split(" ")[0]}` : ""}, te comparto tu cotización ${row.folio}: ${quoteUrl(row)}`;

/** wa.me link to the customer's WhatsApp (digits only; Mexican 10-digit numbers get +52). */
export function whatsappLink(phone: string, text: string) {
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 10) digits = `52${digits}`;
  return digits.length >= 10 ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : null;
}

export async function copyQuoteLink(row: Pick<QuoteRow, "path" | "folio">) {
  try {
    await navigator.clipboard.writeText(quoteUrl(row));
    toast.success(`Link de ${row.folio} copiado`);
  } catch {
    toast.error("No se pudo copiar; ábrelo y copia la dirección");
  }
}

const STATUS: Record<QuoteRow["status"], { label: string; className: string }> = {
  sent: { label: "Enviada", className: "bg-muted text-muted-foreground" },
  viewed: { label: "Vista", className: "bg-sky-500/15 text-sky-800 dark:text-sky-300" },
  accepted: { label: "Aceptada", className: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300" },
  expired: { label: "Vencida", className: "bg-amber-500/15 text-amber-800 dark:text-amber-300" },
};

export function QuoteStatusBadge({ row }: { row: QuoteRow }) {
  const s = STATUS[row.status];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${s.className}`}>
      {s.label}
      {row.views > 0 && row.status !== "sent" && ` · ${row.views} ${row.views === 1 ? "vista" : "vistas"}`}
    </span>
  );
}

/** Copy link · Open · PDF · WhatsApp for one quote (history rows and the "generated" panel). */
export function QuoteLinkActions({ row, size = "sm", labels = false }: { row: QuoteRow; size?: "sm" | "xs"; labels?: boolean }) {
  const [phone, setPhone] = useState(row.clientWhatsapp);
  const [asking, setAsking] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const iconSize = size === "xs" ? "icon-xs" : "icon-sm";
  const wa = whatsappLink(phone, quoteMessage(row));

  async function pdf() {
    setPdfBusy(true);
    try {
      await apiDownload(`/api/quotes/${row.id}/pdf`, row.fileName ?? `${row.folio}${row.clientName ? ` ${row.clientName}` : ""}.pdf`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPdfBusy(false);
    }
  }

  function whatsapp() {
    if (!wa) return setAsking(true);
    window.open(wa, "_blank", "noopener");
  }

  const btn = (label: string, icon: React.ReactNode, onClick: () => void, disabled = false) =>
    labels ? (
      <Button variant="outline" size={size} onClick={onClick} disabled={disabled}>
        {icon} {label}
      </Button>
    ) : (
      <Button variant="ghost" size={iconSize} aria-label={label} title={label} onClick={onClick} disabled={disabled}>
        {icon}
      </Button>
    );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        {btn("Copiar link", <Copy />, () => copyQuoteLink(row), !row.path)}
        {btn("Abrir", <ExternalLink />, () => window.open(quoteUrl(row), "_blank", "noopener"), !row.path)}
        {btn(pdfBusy ? "Generando PDF…" : "Descargar PDF", <Download />, pdf, pdfBusy)}
        {btn("Enviar por WhatsApp", <MessageCircle />, whatsapp, !row.path)}
      </div>
      {asking && !wa && (
        <div className="flex gap-2">
          <input
            autoFocus
            type="tel"
            className="h-8 min-w-0 flex-1 rounded-lg border bg-background px-2 text-sm"
            placeholder="WhatsApp del cliente (10 dígitos o con +52)"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <Button size="sm" disabled={!whatsappLink(phone, "")} onClick={() => (setAsking(false), window.open(whatsappLink(phone, quoteMessage(row))!, "_blank", "noopener"))}>
            Abrir WhatsApp
          </Button>
        </div>
      )}
    </div>
  );
}
