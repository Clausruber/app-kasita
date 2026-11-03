import "server-only";

import type { ComponentProps } from "react";
import { Document, Image, Link, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { quoteFor } from "@/lib/quote-math";
import type { QuoteDoc } from "@/lib/quotes-server";
import { money } from "@/lib/vehicle-catalog";

// Catalog / quote PDF (Letter). Images arrive already downloaded and resized (lib/catalog-pdf-render.ts).

export type PdfAssets = {
  logo: Buffer | null; // PNG
  photos: Record<string, Buffer>; // url → JPEG
  link: string | null; // public quote page
  qr: Buffer | null; // PNG of `link`
};
export type PdfCompany = { name: string; address: string; phone: string; whatsapp: string; email: string; website: string };

type ImageStyle = Extract<ComponentProps<typeof Image>["style"], object>;

const INK = "#111827";
const MUTED = "#6b7280";
const LINE = "#e5e7eb";
const ACCENT = "#b91c1c";

const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 54, paddingHorizontal: 36, fontSize: 10, color: INK, fontFamily: "Helvetica" },
  header: { flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: LINE, paddingBottom: 10, marginBottom: 16 },
  logo: { width: 110, height: 44, objectFit: "contain", marginRight: 12 },
  company: { flexGrow: 1, flexShrink: 1, marginRight: 12 },
  companyName: { fontSize: 13, fontFamily: "Helvetica-Bold" },
  small: { fontSize: 8, color: MUTED },
  folioBox: { alignItems: "flex-end", width: 140, flexShrink: 0 },
  folio: { fontSize: 12, fontFamily: "Helvetica-Bold", color: ACCENT },
  h1: { fontSize: 20, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  h2: { fontSize: 14, fontFamily: "Helvetica-Bold", marginBottom: 6 },
  label: { fontSize: 8, color: MUTED, textTransform: "uppercase", letterSpacing: 0.5 },
  row: { flexDirection: "row" },
  card: { borderWidth: 1, borderColor: LINE, borderRadius: 6, padding: 10 },
  hero: { width: "100%", height: 205, objectFit: "cover", borderRadius: 6 },
  thumb: { height: 62, objectFit: "cover", borderRadius: 4, flexGrow: 1, flexBasis: 0 },
  price: { fontSize: 22, fontFamily: "Helvetica-Bold", color: ACCENT },
  specs: { flexDirection: "row", flexWrap: "wrap", marginTop: 8 },
  spec: { width: "33%", marginBottom: 4 },
  table: { borderWidth: 1, borderColor: LINE, borderRadius: 4, marginTop: 6 },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: LINE },
  th: { flexGrow: 1, flexBasis: 0, padding: 5, fontSize: 8, fontFamily: "Helvetica-Bold", backgroundColor: "#f3f4f6" },
  td: { flexGrow: 1, flexBasis: 0, padding: 4, fontSize: 9 },
  warn: { fontSize: 8, color: "#92400e", marginTop: 4 },
  footer: { position: "absolute", bottom: 22, left: 36, right: 36, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: MUTED },
});

const shortDate = (d: Date) => new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Mexico_City" }).format(d);
const km = (n: number) => (n ? `${n.toLocaleString("es-MX")} km` : "0 km");

function Header({ q, company, assets }: { q: QuoteDoc; company: PdfCompany; assets: PdfAssets }) {
  const created = q.createdAt?.toDate?.() ?? new Date();
  const until = new Date(created.getTime() + q.validDays * 86_400_000);
  return (
    <View style={s.header} fixed>
      {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
      {assets.logo && <Image style={s.logo} src={{ data: assets.logo, format: "png" }} />}
      <View style={s.company}>
        <Text style={s.companyName}>{company.name || "Catálogo de autos"}</Text>
        {company.address ? <Text style={s.small}>{company.address}</Text> : null}
        <Text style={s.small}>{[company.phone && `Tel. ${company.phone}`, company.whatsapp && `WhatsApp ${company.whatsapp}`].filter(Boolean).join("  ·  ")}</Text>
        <Text style={s.small}>{[company.email, company.website].filter(Boolean).join("  ·  ")}</Text>
      </View>
      <View style={s.folioBox}>
        <Text style={s.folio}>{q.folio}</Text>
        <Text style={s.small}>{shortDate(created)}</Text>
        <Text style={s.small}>Vigente hasta {shortDate(until)}</Text>
      </View>
    </View>
  );
}

/** "Ver en línea": QR + link to the public page (simulator, test drive, accept). */
function OnlineBox({ assets }: { assets: PdfAssets }) {
  if (!assets.link) return null;
  return (
    <View style={[s.card, s.row, { marginTop: 10, alignItems: "center" }]} wrap={false}>
      {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
      {assets.qr && <Image style={{ width: 64, height: 64, marginRight: 10 }} src={{ data: assets.qr, format: "png" }} />}
      <View style={{ flexShrink: 1 }}>
        <Text style={{ fontFamily: "Helvetica-Bold", marginBottom: 2 }}>Ve esta cotización en línea</Text>
        <Text style={s.small}>Simula tu financiamiento, agenda una prueba de manejo o avísanos qué auto te interesa.</Text>
        <Link src={assets.link} style={{ fontSize: 8, color: ACCENT, marginTop: 2 }}>
          {assets.link}
        </Link>
      </View>
    </View>
  );
}

function Footer({ q }: { q: QuoteDoc }) {
  return (
    <View style={s.footer} fixed>
      <Text>{q.financing ? "Cotización informativa; el financiamiento está sujeto a aprobación de crédito." : "Precios sujetos a cambio y a disponibilidad."}</Text>
      <Text render={({ pageNumber, totalPages }) => `${q.folio} · ${pageNumber}/${totalPages}`} />
    </View>
  );
}

function Photo({ url, assets, style }: { url: string | undefined; assets: PdfAssets; style: ImageStyle }) {
  const data = url ? assets.photos[url] : undefined;
  if (!data) return <View style={[style, { backgroundColor: "#f3f4f6" }]} />;
  // react-pdf images have no alt attribute (jsx-a11y assumes an HTML img).
  // eslint-disable-next-line jsx-a11y/alt-text
  return <Image style={style} src={{ data, format: "jpg" }} />;
}

function Cover({ q, assets }: { q: QuoteDoc; assets: PdfAssets }) {
  return (
    <View>
      <Text style={s.label}>{q.financing ? "Cotización" : "Catálogo"}</Text>
      <Text style={s.h1}>{q.vehicles.length === 1 ? q.vehicles[0].title : `${q.vehicles.length} opciones para ti`}</Text>
      <View style={[s.row, { marginBottom: 14 }]}>
        {q.clientName ? <Text style={{ marginRight: 16 }}>Preparado para: {q.clientName}</Text> : null}
        {q.sellerName ? <Text style={{ color: MUTED }}>Asesor: {q.sellerName}</Text> : null}
      </View>
      {q.vehicles.map((v, i) => (
        <View key={v.id} style={[s.card, s.row, { marginBottom: 6, padding: 8, alignItems: "center" }]}>
          <Photo url={v.photos[0]} assets={assets} style={{ width: 100, height: 64, objectFit: "cover", borderRadius: 4 }} />
          <View style={{ flexGrow: 1, marginLeft: 12 }}>
            <Text style={s.label}>Opción {i + 1}</Text>
            <Text style={{ fontSize: 12, fontFamily: "Helvetica-Bold" }}>{v.title}</Text>
            <Text style={s.small}>{[v.year, km(v.km), v.transmission, v.fuel].filter(Boolean).join("  ·  ")}</Text>
          </View>
          <Text style={{ fontSize: 14, fontFamily: "Helvetica-Bold", color: ACCENT }}>{money(v.price)}</Text>
        </View>
      ))}
      {q.notes ? (
        <View style={[s.card, { marginTop: 8 }]}>
          <Text style={s.label}>Notas</Text>
          <Text>{q.notes}</Text>
        </View>
      ) : null}
      <OnlineBox assets={assets} />
    </View>
  );
}

function VehiclePage({ q, v, assets }: { q: QuoteDoc; v: QuoteDoc["vehicles"][number]; assets: PdfAssets }) {
  const quote = quoteFor(v.price, q.financing, q.tradeIn, q.minDownPct);
  const specs: [string, string][] = (
    [
      ["Año", String(v.year)],
      ["Kilometraje", km(v.km)],
      ["Condición", v.condition],
      ["Transmisión", v.transmission],
      ["Combustible", v.fuel],
      ["Carrocería", v.bodyType],
      ["Color", v.color],
      ["Motor", v.engine && `${v.engine} L`],
      ["Ubicación", v.location],
    ] as [string, string][]
  ).filter(([, val]) => val);
  return (
    <View>
      <Photo url={v.photos[0]} assets={assets} style={s.hero} />
      {v.photos.length > 1 && (
        <View style={[s.row, { marginTop: 6, gap: 6 }]}>
          {v.photos.slice(1, 3).map((p) => (
            <Photo key={p} url={p} assets={assets} style={s.thumb} />
          ))}
        </View>
      )}
      <View style={[s.row, { marginTop: 12, justifyContent: "space-between", alignItems: "flex-end" }]}>
        <View style={{ flexShrink: 1 }}>
          <Text style={s.h2}>{v.title}</Text>
          {v.trim ? <Text style={s.small}>{v.trim}</Text> : null}
        </View>
        <Text style={s.price}>{money(v.price)}</Text>
      </View>
      <View style={s.specs}>
        {specs.map(([k, val]) => (
          <View key={k} style={s.spec}>
            <Text style={s.label}>{k}</Text>
            <Text>{val}</Text>
          </View>
        ))}
      </View>
      {v.features.length > 0 && <Text style={[s.small, { marginTop: 2 }]}>Equipamiento: {v.features.join(" · ")}</Text>}

      {q.financing && (
        <View style={[s.card, { marginTop: 12 }]} wrap={false}>
          <Text style={[s.h2, { fontSize: 12 }]}>Plan de financiamiento</Text>
          <View style={s.row}>
            {(
              [
                ["Precio", money(quote.price)],
                ...(quote.tradeIn ? [["Auto a cuenta", `- ${money(quote.tradeIn)}`]] : []),
                ["Enganche", `- ${money(quote.cashDown)}`],
                ["A financiar", money(quote.financed)],
                ["Tasa anual", `${q.financing.rate}%${q.financing.ivaOnInterest ? " + IVA" : ""}`],
              ] as [string, string][]
            ).map(([k, val]) => (
              <View key={k} style={{ flexGrow: 1 }}>
                <Text style={s.label}>{k}</Text>
                <Text style={{ fontFamily: "Helvetica-Bold" }}>{val}</Text>
              </View>
            ))}
          </View>
          {q.tradeIn?.description ? <Text style={[s.small, { marginTop: 4 }]}>Auto a cuenta: {q.tradeIn.description}</Text> : null}
          {quote.financed > 0 ? (
            <View style={s.table}>
              <View style={s.tr}>
                <Text style={s.th}>Plazo</Text>
                <Text style={s.th}>Mensualidad</Text>
                <Text style={s.th}>Total a pagar</Text>
              </View>
              {quote.rows.map((r) => (
                <View key={r.months} style={s.tr}>
                  <Text style={s.td}>{r.months} meses</Text>
                  <Text style={[s.td, { fontFamily: "Helvetica-Bold" }]}>{money(r.payment)}</Text>
                  <Text style={s.td}>{money(r.total)}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={{ marginTop: 6 }}>{quote.credit > 0 ? `Saldo a favor del cliente: ${money(quote.credit)}` : "Pago de contado: no hay monto a financiar."}</Text>
          )}
          {quote.warnings.map((w) => (
            <Text key={w} style={s.warn}>
              {w}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

function Comparison({ q }: { q: QuoteDoc }) {
  const quotes = q.vehicles.map((v) => ({ v, quote: quoteFor(v.price, q.financing, q.tradeIn, q.minDownPct) }));
  const terms = q.financing?.terms ?? [];
  const mid = terms[Math.floor((terms.length - 1) / 2)];
  const rows: [string, (x: (typeof quotes)[number]) => string][] = [
    ["Precio", (x) => money(x.v.price)],
    ["Año", (x) => String(x.v.year)],
    ["Kilometraje", (x) => km(x.v.km)],
    ["Transmisión", (x) => x.v.transmission || "—"],
    ...(q.financing
      ? ([
          ["Enganche total", (x) => money(x.quote.totalDown)],
          ["A financiar", (x) => money(x.quote.financed)],
          ...(mid ? [[`Mensualidad ${mid} meses`, (x: (typeof quotes)[number]) => money(x.quote.rows.find((r) => r.months === mid)?.payment ?? 0)]] : []),
        ] as [string, (x: (typeof quotes)[number]) => string][])
      : []),
  ];
  return (
    <View>
      <Text style={s.h2}>Comparativo</Text>
      <View style={s.table}>
        <View style={s.tr}>
          <Text style={s.th} />
          {quotes.map((x, i) => (
            <Text key={x.v.id} style={s.th}>
              {i + 1}. {x.v.title}
            </Text>
          ))}
        </View>
        {rows.map(([label, value]) => (
          <View key={label} style={s.tr}>
            <Text style={[s.td, { color: MUTED }]}>{label}</Text>
            {quotes.map((x) => (
              <Text key={x.v.id} style={s.td}>
                {value(x)}
              </Text>
            ))}
          </View>
        ))}
      </View>
      {q.conditions ? (
        <View style={{ marginTop: 16 }}>
          <Text style={s.label}>Condiciones</Text>
          <Text style={s.small}>{q.conditions}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** The whole catalog: cover with the options, one page per car and, with 2+ cars, a comparison. */
export function CatalogPdf({ q, company, assets }: { q: QuoteDoc; company: PdfCompany; assets: PdfAssets }) {
  const single = q.vehicles.length === 1;
  return (
    <Document title={`${q.folio} ${q.clientName}`.trim()} author={company.name || "Autolix"} creator="Autolix">
      {!single && (
        <Page size="LETTER" style={s.page}>
          <Header q={q} company={company} assets={assets} />
          <Cover q={q} assets={assets} />
          <Footer q={q} />
        </Page>
      )}
      {q.vehicles.map((v) => (
        <Page key={v.id} size="LETTER" style={s.page}>
          <Header q={q} company={company} assets={assets} />
          {single && (
            <View style={[s.row, { marginBottom: 8 }]}>
              {q.clientName ? <Text style={{ marginRight: 16 }}>Preparado para: {q.clientName}</Text> : null}
              {q.sellerName ? <Text style={{ color: MUTED }}>Asesor: {q.sellerName}</Text> : null}
            </View>
          )}
          <VehiclePage q={q} v={v} assets={assets} />
          {single && <OnlineBox assets={assets} />}
          {single && (q.notes || q.conditions) ? (
            <View style={{ marginTop: 10 }}>
              {q.notes ? <Text style={s.small}>Notas: {q.notes}</Text> : null}
              {q.conditions ? <Text style={s.small}>{q.conditions}</Text> : null}
            </View>
          ) : null}
          <Footer q={q} />
        </Page>
      ))}
      {!single && (
        <Page size="LETTER" style={s.page}>
          <Header q={q} company={company} assets={assets} />
          <Comparison q={q} />
          <Footer q={q} />
        </Page>
      )}
    </Document>
  );
}
