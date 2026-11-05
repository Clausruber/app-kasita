"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { CheckCircle2, FileText, Plus, Search } from "lucide-react";
import { api } from "@/lib/api";
import { useCan } from "@/hooks/use-me";
import { QuoteBuilder, type QuoteRow } from "@/components/quotes/quote-builder";
import { QuoteLinkActions, QuoteStatusBadge, quoteUrl } from "@/components/quotes/quote-links";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const STATUS_FILTERS: { id: "all" | QuoteRow["status"]; label: string }[] = [
  { id: "all", label: "Todas" },
  { id: "sent", label: "Enviadas" },
  { id: "viewed", label: "Vistas" },
  { id: "accepted", label: "Aceptadas" },
  { id: "expired", label: "Vencidas" },
];
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Cotizaciones: build a quote link (filters, up to 5 properties, client) and follow every quote sent. */
export default function QuotesPage() {
  const can = useCan()("inventory");
  const [created, setCreated] = useState<QuoteRow | null>(null);
  const [builderKey, setBuilderKey] = useState(0);
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]["id"]>("all");
  const [q, setQ] = useState("");
  const list = useQuery({ queryKey: ["quotes", "all"], enabled: can, queryFn: () => api<{ quotes: QuoteRow[] }>("/api/quotes") });

  const rows = useMemo(() => {
    const term = norm(q.trim());
    return (list.data?.quotes ?? [])
      .filter((r) => status === "all" || r.status === status)
      .filter((r) => !term || norm([r.folio, r.clientName, r.clientWhatsapp, ...r.properties.map((v) => v.title)].join(" ")).includes(term));
  }, [list.data, status, q]);
  const counts = useMemo(() => {
    const all = list.data?.quotes ?? [];
    return Object.fromEntries(STATUS_FILTERS.map((s) => [s.id, s.id === "all" ? all.length : all.filter((r) => r.status === s.id).length]));
  }, [list.data]);

  if (!can) return <p className="text-sm text-muted-foreground">No tienes acceso a las cotizaciones.</p>;

  return (
    <div className="space-y-4">
      <h1 className="flex items-center gap-2 text-2xl font-semibold">
        <FileText className="size-6" /> Cotizaciones
      </h1>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>{created ? "Cotización lista" : "Nueva cotización"}</CardTitle>
          </CardHeader>
          <CardContent>
            {created ? (
              <div className="space-y-4">
                <p className="flex items-center gap-2 font-medium">
                  <CheckCircle2 className="size-5 text-emerald-600" /> {created.folio}
                  {created.clientName && <span className="font-normal text-muted-foreground">para {created.clientName}</span>}
                </p>
                <p className="rounded-lg bg-muted px-3 py-2 font-mono text-xs break-all">{quoteUrl(created)}</p>
                <QuoteLinkActions row={created} labels />
                <p className="text-xs text-muted-foreground">Te avisamos en Seguimientos cuando el cliente abra el link, agende una visita o elija una propiedad.</p>
                <Button
                  variant="outline"
                  onClick={() => {
                    setCreated(null);
                    setBuilderKey((k) => k + 1);
                  }}
                >
                  <Plus /> Nueva cotización
                </Button>
              </div>
            ) : (
              <QuoteBuilder key={builderKey} variant="full" actionLabel="Generar cotización" onCreated={setCreated} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-3">
            <CardTitle>Enviadas</CardTitle>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_FILTERS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStatus(s.id)}
                  className={cn("rounded-full border px-2.5 py-1 text-xs", status === s.id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
                >
                  {s.label} <span className="opacity-70">{counts[s.id] ?? 0}</span>
                </button>
              ))}
            </div>
            <div className="relative">
              <Search className="absolute top-2 left-2 size-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Buscar folio, cliente o auto…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </CardHeader>
          <CardContent>
            {list.isLoading ? (
              <p className="text-sm text-muted-foreground">Cargando…</p>
            ) : list.error ? (
              <p className="text-sm text-destructive">{(list.error as Error).message}</p>
            ) : !rows.length ? (
              <p className="text-sm text-muted-foreground">{list.data?.quotes.length ? "Ninguna coincide con los filtros." : "Aún no has enviado cotizaciones."}</p>
            ) : (
              <ul className="divide-y">
                {rows.map((r) => (
                  <li key={r.id} className="space-y-1 py-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold">{r.folio}</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.clientName || "Sin cliente"}</span>
                      <QuoteStatusBadge row={r} />
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {r.accepted
                        ? `Le interesa: ${r.accepted.propertyTitle}${r.accepted.months ? ` · crédito con ${r.accepted.downPct}% a ${r.accepted.months / 12} años` : ""}`
                        : r.properties.map((v) => v.title).join(", ")}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-3 text-[11px] text-muted-foreground">
                      {r.createdAt && <span>Creada {format(new Date(r.createdAt), "d MMM, HH:mm", { locale: es })}</span>}
                      <span>Vigente hasta {format(new Date(r.validUntil), "d MMM", { locale: es })}</span>
                      {r.lastViewedAt && <span>Última vista {format(new Date(r.lastViewedAt), "d MMM, HH:mm", { locale: es })}</span>}
                      {r.sellerName && <span>{r.sellerName}</span>}
                    </div>
                    <QuoteLinkActions row={r} size="xs" />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
