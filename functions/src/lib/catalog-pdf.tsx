
import type { ComponentProps } from "react";
import { Document, Image, Link, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { MAX_QUOTE_PHOTOS, quoteFor, termLabel } from "./quote-math";
import type { QuoteDoc } from "./quotes-server";
import { forRent, forSale, money, operationLabel, priceLine } from "./property-catalog";

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
  // 6 photo boxes: 3 columns × 2 rows (540 pt of usable width, 6 pt gaps).
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  gridPhoto: { width: 176, height: 118, objectFit: "cover", borderRadius: 4 },
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
const m2 = (n: number | null) => (n ? `${n.toLocaleString("es-MX")} m²` : "");
type QP = QuoteDoc["properties"][number];
const salePriceOf = (v: QP) => (forSale(v.operation ?? "venta") ? (v.salePrice ?? v.price) : 0);
/** "2 rec · 2 baños · 1 est · 85 m²" */
const specsOf = (v: QP) =>
  [
    v.bedrooms ? `${v.bedrooms} rec` : "",
    v.bathrooms ? `${v.bathrooms} ${v.bathrooms === 1 ? "baño" : "baños"}` : "",
    v.parking ? `${v.parking} est` : "",
    m2(v.builtArea || v.landArea),
  ]
    .filter(Boolean)
    .join("  ·  ");

function Header({ q, company, assets }: { q: QuoteDoc; company: PdfCompany; assets: PdfAssets }) {
  const created = q.createdAt?.toDate?.() ?? new Date();
  const until = new Date(created.getTime() + q.validDays * 86_400_000);
  return (
    <View style={s.header} fixed>
      {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
      {assets.logo && <Image style={s.logo} src={{ data: assets.logo, format: "png" }} />}
      <View style={s.company}>
        <Text style={s.companyName}>{company.name || "Catálogo de propiedades"}</Text>
        {company.address ? <Text style={s.small}>{company.address}</Text> : null}
        <Text style={s.small}>{[company.phone && `Tel. ${company.phone}`, company.whatsapp && `WhatsApp ${company.whatsapp}`, company.email].filter(Boolean).join("  |  ")}</Text>
        {company.website ? <Text style={s.small}>{company.website}</Text> : null}
      </View>
      <View style={s.folioBox}>
        <Text style={s.folio}>{q.folio}</Text>
        <Text style={s.small}>{shortDate(created)}</Text>
        <Text style={s.small}>Vigente hasta {shortDate(until)}</Text>
      </View>
    </View>
  );
}

/** "Ver en línea": QR + link to the public page (simulator, visit, accept). */
function OnlineBox({ assets }: { assets: PdfAssets }) {
  if (!assets.link) return null;
  return (
    <View style={[s.card, s.row, { marginTop: 10, alignItems: "center" }]} wrap={false}>
      {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
      {assets.qr && <Image style={{ width: 64, height: 64, marginRight: 10 }} src={{ data: assets.qr, format: "png" }} />}
      <View style={{ flexShrink: 1 }}>
        <Text style={{ fontFamily: "Helvetica-Bold", marginBottom: 2 }}>Ve esta cotización en línea</Text>
        <Text style={s.small}>Simula tu crédito, agenda una visita o avísanos qué propiedad te interesa.</Text>
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
      <Text>{q.financing ? "Cotización informativa; el crédito está sujeto a aprobación de la institución financiera." : "Precios sujetos a cambio y a disponibilidad."}</Text>
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

/** "Cotización para: <cliente>" on the left, the advisor on the right, on one line. */
function ClientSellerLine({ q, marginBottom }: { q: QuoteDoc; marginBottom: number }) {
  if (!q.clientName && !q.sellerName) return null;
  return (
    <View style={[s.row, { justifyContent: "space-between", alignItems: "center", marginBottom }]}>
      <Text>
        {q.clientName ? (
          <>
            <Text style={{ color: MUTED }}>Cotización para: </Text>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>{q.clientName}</Text>
          </>
        ) : null}
      </Text>
      {q.sellerName ? <Text style={{ color: MUTED, textAlign: "right" }}>Asesor: {q.sellerName}</Text> : null}
    </View>
  );
}

function Cover({ q, assets }: { q: QuoteDoc; assets: PdfAssets }) {
  return (
    <View>
      <Text style={s.label}>{q.financing ? "Cotización" : "Catálogo"}</Text>
      <Text style={s.h1}>{q.properties.length === 1 ? q.properties[0].title : `${q.properties.length} opciones para ti`}</Text>
      <ClientSellerLine q={q} marginBottom={14} />
      {q.properties.map((v, i) => (
        <View key={v.id} style={[s.card, s.row, { marginBottom: 6, padding: 8, alignItems: "center" }]}>
          <Photo url={v.photos[0]} assets={assets} style={{ width: 100, height: 64, objectFit: "cover", borderRadius: 4 }} />
          <View style={{ flexGrow: 1, marginLeft: 12 }}>
            <Text style={s.label}>Opción {i + 1}</Text>
            <Text style={{ fontSize: 12, fontFamily: "Helvetica-Bold" }}>{v.title}</Text>
            <Text style={s.small}>{[v.propertyType, specsOf(v), v.location].filter(Boolean).join("  ·  ")}</Text>
          </View>
          <Text style={{ fontSize: 12, fontFamily: "Helvetica-Bold", color: ACCENT }}>{priceLine(v)}</Text>
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

function PropertyPage({ q, v, assets }: { q: QuoteDoc; v: QP; assets: PdfAssets }) {
  const salePrice = salePriceOf(v);
  const quote = quoteFor(salePrice, q.financing, q.minDownPct);
  const specs: [string, string][] = (
    [
      ["Tipo", v.propertyType],
      ["Operación", operationLabel(v.operation ?? "venta")],
      ["Recámaras", v.bedrooms ? String(v.bedrooms) : ""],
      ["Baños", v.bathrooms ? String(v.bathrooms) : ""],
      ["Estacionamientos", v.parking ? String(v.parking) : ""],
      ["Construcción", m2(v.builtArea)],
      ["Terreno", m2(v.landArea)],
      ["Mantenimiento", v.maintenanceFee ? `${money(v.maintenanceFee)}/mes` : ""],
      ["Ubicación", v.location],
    ] as [string, string][]
  ).filter(([, val]) => val);
  return (
    <View>
      {v.photos.length > 0 && (
        <View style={s.photoGrid}>
          {Array.from({ length: MAX_QUOTE_PHOTOS }, (_, i) => (
            <Photo key={i} url={v.photos[i]} assets={assets} style={s.gridPhoto} />
          ))}
        </View>
      )}
      <View style={[s.row, { marginTop: 12, justifyContent: "space-between", alignItems: "flex-end" }]}>
        <View style={{ flexShrink: 1 }}>
          <Text style={s.h2}>{v.title}</Text>
        </View>
        <Text style={s.price}>{priceLine(v)}</Text>
      </View>
      <View style={s.specs}>
        {specs.map(([k, val]) => (
          <View key={k} style={s.spec}>
            <Text style={s.label}>{k}</Text>
            <Text>{val}</Text>
          </View>
        ))}
      </View>
      {v.highlights?.length ? <Text style={{ marginTop: 4 }}>{v.highlights.map((h) => `• ${h}`).join("    ")}</Text> : null}
      {v.amenities.length > 0 && <Text style={[s.small, { marginTop: 2 }]}>Amenidades: {v.amenities.join(" · ")}</Text>}

      {q.financing && salePrice > 0 && (
        <View style={[s.card, { marginTop: 12 }]} wrap={false}>
          <Text style={[s.h2, { fontSize: 12 }]}>Simulación de crédito hipotecario</Text>
          <View style={s.row}>
            {(
              [
                ["Precio", money(quote.price)],
                ["Enganche", `- ${money(quote.down)}`],
                ["Crédito", money(quote.financed)],
                ["Tasa anual", `${q.financing.rate}%`],
              ] as [string, string][]
            ).map(([k, val]) => (
              <View key={k} style={{ flexGrow: 1 }}>
                <Text style={s.label}>{k}</Text>
                <Text style={{ fontFamily: "Helvetica-Bold" }}>{val}</Text>
              </View>
            ))}
          </View>
          {quote.financed > 0 ? (
            <View style={s.table}>
              <View style={s.tr}>
                <Text style={s.th}>Plazo</Text>
                <Text style={s.th}>Mensualidad</Text>
                <Text style={s.th}>Total a pagar</Text>
              </View>
              {quote.rows.map((r) => (
                <View key={r.months} style={s.tr}>
                  <Text style={s.td}>{termLabel(r.months)}</Text>
                  <Text style={[s.td, { fontFamily: "Helvetica-Bold" }]}>{money(r.payment)}</Text>
                  <Text style={s.td}>{money(r.total)}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={{ marginTop: 6 }}>Pago de contado: no hay monto a financiar.</Text>
          )}
          {quote.warnings.map((w) => (
            <Text key={w} style={s.warn}>
              {w}
            </Text>
          ))}
        </View>
      )}
      {forRent(v.operation ?? "venta") && v.rentPrice ? (
        <View style={[s.card, { marginTop: 12 }]} wrap={false}>
          <Text style={[s.h2, { fontSize: 12 }]}>Renta</Text>
          <View style={s.row}>
            {(
              [
                ["Renta mensual", money(v.rentPrice)],
                ["Mantenimiento", v.maintenanceFee ? money(v.maintenanceFee) : "Incluido"],
                ["Depósito", money(v.rentPrice)],
              ] as [string, string][]
            ).map(([k, val]) => (
              <View key={k} style={{ flexGrow: 1 }}>
                <Text style={s.label}>{k}</Text>
                <Text style={{ fontFamily: "Helvetica-Bold" }}>{val}</Text>
              </View>
            ))}
          </View>
          <Text style={[s.small, { marginTop: 4 }]}>Depósito de referencia: un mes de renta. Sujeto a aprobación de requisitos (identificación, comprobantes de ingresos, aval o póliza jurídica).</Text>
        </View>
      ) : null}
    </View>
  );
}

function Comparison({ q }: { q: QuoteDoc }) {
  const quotes = q.properties.map((v) => ({ v, quote: quoteFor(salePriceOf(v), q.financing, q.minDownPct) }));
  const terms = q.financing?.terms ?? [];
  const mid = terms[Math.floor((terms.length - 1) / 2)];
  const rows: [string, (x: (typeof quotes)[number]) => string][] = [
    ["Precio", (x) => priceLine(x.v)],
    ["Tipo", (x) => x.v.propertyType || "—"],
    ["Recámaras", (x) => String(x.v.bedrooms || "—")],
    ["Baños", (x) => String(x.v.bathrooms || "—")],
    ["Superficie", (x) => m2(x.v.builtArea || x.v.landArea) || "—"],
    ["Ubicación", (x) => x.v.location || "—"],
    ...(q.financing
      ? ([
          ["Enganche", (x) => (x.quote.price ? money(x.quote.down) : "—")],
          ["Crédito", (x) => (x.quote.price ? money(x.quote.financed) : "—")],
          ...(mid
            ? [
                [
                  `Mensualidad a ${termLabel(mid)}`,
                  (x: (typeof quotes)[number]) => (x.quote.price ? money(x.quote.rows.find((r) => r.months === mid)?.payment ?? 0) : "—"),
                ],
              ]
            : []),
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

/** The whole catalog: cover with the options, one page per property and, with 2+ properties, a comparison. */
export function CatalogPdf({ q, company, assets }: { q: QuoteDoc; company: PdfCompany; assets: PdfAssets }) {
  const single = q.properties.length === 1;
  return (
    <Document title={`${q.folio} ${q.clientName}`.trim()} author={company.name || "Kasita"} creator="Kasita">
      {!single && (
        <Page size="LETTER" style={s.page}>
          <Header q={q} company={company} assets={assets} />
          <Cover q={q} assets={assets} />
          <Footer q={q} />
        </Page>
      )}
      {q.properties.map((v) => (
        <Page key={v.id} size="LETTER" style={s.page}>
          <Header q={q} company={company} assets={assets} />
          {single && <ClientSellerLine q={q} marginBottom={8} />}
          <PropertyPage q={q} v={v} assets={assets} />
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
