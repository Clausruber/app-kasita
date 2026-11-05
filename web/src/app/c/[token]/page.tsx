import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BedDouble, Bath, Building2, Car, MapPin, Ruler } from "lucide-react";
import { HttpError } from "@/lib/auth-guard";
import { quoteByToken, toPublicQuote, type PublicQuote } from "@/lib/quote-public";
import { money, operationLabel, priceLine } from "@/lib/property-catalog";
import { QuotePropertyActions, ViewBeacon } from "@/components/quotes/public/quote-actions";

// Public quote page shared by link (WhatsApp/DM). Server-rendered with the Admin SDK; no login.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }> };

async function load(token: string): Promise<PublicQuote | null> {
  try {
    const { uid, quote } = await quoteByToken(token);
    return await toPublicQuote(uid, quote);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return null;
    throw e;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const q = await load((await params).token);
  if (!q) return { title: "Cotización no encontrada", robots: { index: false, follow: false } };
  const title = `${q.company.name || "Cotización"} · ${q.folio}`;
  const description = q.properties.map((v) => `${v.title} ${priceLine(v)}`).join(" · ");
  const image = q.properties[0]?.photos[0];
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: { title, description, type: "website", locale: "es_MX", ...(image ? { images: [{ url: image }] } : {}) },
  };
}

const dateFmt = (iso: string) => new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Mexico_City" }).format(new Date(iso));

export default async function PublicQuotePage({ params }: Props) {
  const { token } = await params;
  const q = await load(token);
  if (!q) notFound();
  const expired = q.status === "expired";

  return (
    <main className="min-h-dvh bg-muted/40">
      <ViewBeacon token={token} />
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          {q.company.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={q.company.logoUrl} alt={q.company.name} className="h-9 w-auto max-w-[96px] shrink-0 object-contain sm:max-w-[140px]" />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{q.company.name || "Cotización"}</p>
            {q.company.address && <p className="truncate text-xs text-muted-foreground">{q.company.address}</p>}
          </div>
          <div className="shrink-0 text-right text-xs">
            <p className="font-mono font-semibold text-primary">{q.folio}</p>
            <p className="text-muted-foreground">Vence {dateFmt(q.validUntil)}</p>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-4 px-4 py-5">
        <section>
          <h1 className="text-2xl font-bold">{q.clientName ? `Cotización para: ${q.clientName}` : "Cotización"}</h1>
          <p className="text-sm text-muted-foreground">{q.properties.length === 1 ? q.properties[0].title : `${q.properties.length} opciones`}</p>
          {q.sellerName && <p className="text-sm text-muted-foreground">Te atiende {q.sellerName}</p>}
        </section>

        {expired && (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
            Esta cotización ya venció. Escríbenos por WhatsApp para actualizar precios y disponibilidad.
          </p>
        )}
        {q.accepted && (
          <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-900 dark:text-emerald-200">
            ¡Gracias! Nos avisaste que te interesa <strong>{q.accepted.propertyTitle}</strong>. Un asesor te contactará en breve.
          </p>
        )}
        {q.notes && <p className="rounded-lg bg-background px-3 py-2 text-sm">{q.notes}</p>}

        {q.properties.map((v, i) => (
          <article key={v.id} className="overflow-hidden rounded-2xl border bg-background shadow-sm">
            {v.photos.length > 0 && (
              <div className="flex snap-x snap-mandatory overflow-x-auto">
                {v.photos.map((p, k) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={p} src={p} alt={`${v.title} foto ${k + 1}`} className="aspect-[4/3] w-full shrink-0 snap-center object-cover sm:w-[85%]" loading={i === 0 && k === 0 ? "eager" : "lazy"} />
                ))}
              </div>
            )}
            <div className="space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  {q.properties.length > 1 && <p className="text-xs text-muted-foreground">Opción {i + 1}</p>}
                  <h2 className="text-lg font-semibold">{v.title}</h2>
                  <p className="text-sm text-muted-foreground">
                    {[v.propertyType, operationLabel(v.operation)].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-primary">{priceLine(v)}</p>
                  {v.maintenanceFee ? <p className="text-xs text-muted-foreground">Mantenimiento {money(v.maintenanceFee)}/mes</p> : null}
                </div>
              </div>
              <ul className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                {v.bedrooms > 0 && <Spec icon={BedDouble} label={`${v.bedrooms} ${v.bedrooms === 1 ? "recámara" : "recámaras"}`} />}
                {v.bathrooms > 0 && <Spec icon={Bath} label={`${v.bathrooms} ${v.bathrooms === 1 ? "baño" : "baños"}`} />}
                {v.parking > 0 && <Spec icon={Car} label={`${v.parking} estacionamiento${v.parking === 1 ? "" : "s"}`} />}
                {v.builtArea ? <Spec icon={Building2} label={`${v.builtArea.toLocaleString("es-MX")} m² construidos`} /> : null}
                {v.landArea ? <Spec icon={Ruler} label={`${v.landArea.toLocaleString("es-MX")} m² de terreno`} /> : null}
                {v.location && <Spec icon={MapPin} label={v.location} />}
              </ul>
              {v.amenities.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {v.amenities.map((f) => (
                    <span key={f} className="rounded-full bg-muted px-2 py-0.5 text-xs">
                      {f}
                    </span>
                  ))}
                </div>
              )}
              <QuotePropertyActions token={token} quote={q} property={v} />
            </div>
          </article>
        ))}

        <footer className="space-y-1 pb-8 text-xs text-muted-foreground">
          {q.conditions && <p>{q.conditions}</p>}
          <p>{[q.company.phone && `Tel. ${q.company.phone}`, q.company.email, q.company.website].filter(Boolean).join(" · ")}</p>
        </footer>
      </div>
    </main>
  );
}

function Spec({ icon: Icon, label }: { icon: typeof MapPin; label: string }) {
  return (
    <li className="flex items-center gap-1.5 text-muted-foreground">
      <Icon className="size-4 shrink-0" />
      <span className="truncate text-foreground">{label}</span>
    </li>
  );
}
