"use client";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { FileText } from "lucide-react";
import { api } from "@/lib/api";
import { useCan } from "@/hooks/use-me";
import { QuoteButton } from "@/components/quotes/catalog-drawer";
import type { QuoteRow } from "@/components/quotes/quote-builder";
import { QuoteLinkActions, QuoteStatusBadge } from "@/components/quotes/quote-links";

/** Client detail → "Cotizaciones": links sent to this client, whether they opened them, and actions. */
export function QuoteHistory({ clientId, clientName, clientWhatsapp }: { clientId: string; clientName: string; clientWhatsapp?: string }) {
  const can = useCan()("inventory");
  const { data } = useQuery({
    queryKey: ["quotes", clientId],
    enabled: can,
    queryFn: () => api<{ quotes: QuoteRow[] }>(`/api/quotes?clientId=${encodeURIComponent(clientId)}`),
  });
  if (!can) return null;

  return (
    <div className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        <FileText className="size-4" /> <span className="mr-auto">Cotizaciones</span>
        <QuoteButton prefill={{ clientId, clientName, clientWhatsapp }} />
      </h3>
      {!data ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : !data.quotes.length ? (
        <p className="text-sm text-muted-foreground">Sin cotizaciones.</p>
      ) : (
        <ul className="divide-y rounded-lg border text-sm">
          {data.quotes.map((q) => (
            <li key={q.id} className="space-y-1 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs">{q.folio}</span>
                <QuoteStatusBadge row={q} />
                {q.createdAt && <span className="ml-auto text-xs text-muted-foreground">{format(new Date(q.createdAt), "d MMM", { locale: es })}</span>}
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {q.accepted ? `Le interesa: ${q.accepted.propertyTitle}${q.accepted.months ? ` · crédito con ${q.accepted.downPct}% a ${q.accepted.months / 12} años` : ""}` : q.properties.map((v) => v.title).join(", ")}
              </p>
              <QuoteLinkActions row={q} size="xs" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
