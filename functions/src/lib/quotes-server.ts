
import { randomBytes } from "crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpError } from "./auth-guard";
import { adminDb } from "./firebase/admin";
import { clientDoc, quoteDoc, quoteTokenDoc, quotesCol, userDoc, propertyDoc } from "./firebase/paths";
import { MAX_CATALOG_PROPERTIES, MAX_QUOTE_PHOTOS, QUOTE_DEFAULTS, TERM_OPTIONS, type Financing, type QuoteDefaults } from "./quote-math";
import { mainPrice } from "./property-catalog";
import type { Operation } from "./types";

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown, min: number, max: number, name: string) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${name} debe estar entre ${min} y ${max}`);
  return n;
};

/** What the PDF shows of each property, frozen when the catalog is generated (never the exact address or owner). */
export type QuoteProperty = {
  id: string;
  title: string;
  propertyType: string;
  operation: Operation;
  price: number; // main price: sale price, or monthly rent for rent-only listings
  salePrice: number | null;
  rentPrice: number | null;
  maintenanceFee: number | null;
  bedrooms: number;
  bathrooms: number; // half baths count 0.5
  parking: number;
  builtArea: number | null;
  landArea: number | null;
  location: string; // colonia, ciudad
  amenities: string[];
  highlights?: string[]; // absent in quotes saved before highlights existed
  photos: string[]; // up to MAX_QUOTE_PHOTOS, chosen in the quote form (default: the first ones)
};

export type QuoteDoc = {
  folio: string;
  conversationId: string | null;
  clientId: string | null;
  clientName: string;
  dealId: string | null;
  properties: QuoteProperty[];
  financing: Financing | null;
  minDownPct: number;
  validDays: number;
  notes: string;
  conditions: string;
  sellerId: string | null;
  sellerName: string;
  pdfUrl: string | null;
  createdAt: Timestamp;
  // Public link (/c/{token})
  token?: string;
  allowSimulation?: boolean;
  clientWhatsapp?: string;
  status?: "sent" | "viewed" | "accepted";
  views?: number;
  firstViewedAt?: Timestamp | null;
  lastViewedAt?: Timestamp | null;
  accepted?: { propertyId: string; propertyTitle: string; downPct: number | null; months: number | null; at: Timestamp } | null;
  bookingId?: string | null;
};

export type QuoteStatus = "sent" | "viewed" | "accepted" | "expired";

export const validUntil = (q: Pick<QuoteDoc, "createdAt" | "validDays">) => new Date((q.createdAt?.toMillis?.() ?? Date.now()) + q.validDays * 86_400_000);

/** Accepted wins; otherwise a quote past its validity is expired. */
export function quoteStatus(q: QuoteDoc): QuoteStatus {
  if (q.status === "accepted") return "accepted";
  if (validUntil(q).getTime() < Date.now()) return "expired";
  return q.status === "viewed" ? "viewed" : "sent";
}

export const quotePath = (token: string) => `/c/${token}`;

export function parseQuoteDefaults(v: Partial<Record<keyof QuoteDefaults, unknown>> | undefined): QuoteDefaults {
  const d = QUOTE_DEFAULTS;
  const n = (x: unknown, fallback: number, min: number, max: number) => (Number.isFinite(Number(x)) && Number(x) >= min && Number(x) <= max ? Number(x) : fallback);
  const terms = Array.isArray(v?.terms) ? v.terms.map(Number).filter((t) => (TERM_OPTIONS as readonly number[]).includes(t)) : [];
  return {
    rate: n(v?.rate, d.rate, 0, 100),
    minDownPct: n(v?.minDownPct, d.minDownPct, 0, 90),
    terms: terms.length ? [...new Set(terms)].sort((a, b) => a - b) : d.terms,
    validDays: Math.round(n(v?.validDays, d.validDays, 1, 90)),
    conditions: typeof v?.conditions === "string" ? v.conditions.trim().slice(0, 1500) : d.conditions,
  };
}

export async function readQuoteDefaults(uid: string) {
  return parseQuoteDefaults((await adminDb.doc(userDoc(uid)).get()).get("quoteDefaults"));
}

export type QuoteInput = {
  propertyIds: string[];
  conversationId: string | null;
  clientId: string | null;
  clientName: string;
  dealId: string | null;
  financing: Financing | null;
  validDays: number;
  notes: string;
  allowSimulation: boolean;
  clientWhatsapp: string;
  /** propertyId → photo URLs chosen for the quote, in order. Missing: the property's first photos. */
  photos: Record<string, string[]>;
};

export function parseQuoteInput(b: Record<string, unknown>): QuoteInput {
  const ids = Array.isArray(b.propertyIds) ? [...new Set(b.propertyIds.filter((x): x is string => typeof x === "string" && !!x && !x.includes("/")))] : [];
  if (!ids.length) throw new HttpError(400, "Agrega al menos una propiedad");
  if (ids.length > MAX_CATALOG_PROPERTIES) throw new HttpError(400, `Máximo ${MAX_CATALOG_PROPERTIES} propiedades por catálogo`);
  const f = b.financing as Record<string, unknown> | null | undefined;
  let financing: Financing | null = null;
  if (f) {
    const downMode = f.downMode === "amount" ? "amount" : "pct";
    const terms = (Array.isArray(f.terms) ? f.terms.map(Number) : []).filter((t) => (TERM_OPTIONS as readonly number[]).includes(t));
    if (!terms.length) throw new HttpError(400, "Elige al menos un plazo");
    financing = {
      downMode,
      down: downMode === "pct" ? num(f.down ?? 0, 0, 100, "El enganche (%)") : num(f.down ?? 0, 0, 2_000_000_000, "El enganche"),
      rate: num(f.rate ?? 0, 0, 100, "La tasa"),
      terms: [...new Set(terms)].sort((x, y) => x - y),
    };
  }
  const id = (v: unknown) => (typeof v === "string" && v && !v.includes("/") ? v.slice(0, 200) : null);
  return {
    propertyIds: ids,
    conversationId: id(b.conversationId),
    clientId: id(b.clientId),
    clientName: clip(b.clientName, 120),
    dealId: id(b.dealId),
    financing,
    validDays: Math.round(num(b.validDays ?? QUOTE_DEFAULTS.validDays, 1, 90, "La vigencia")),
    notes: clip(b.notes, 1000),
    allowSimulation: b.allowSimulation !== false,
    clientWhatsapp: clip(b.clientWhatsapp, 30).replace(/[^\d+]/g, ""),
    photos: parsePhotoChoice(b.photos, ids),
  };
}

function parsePhotoChoice(v: unknown, ids: string[]): Record<string, string[]> {
  if (!v || typeof v !== "object") return {};
  const out: Record<string, string[]> = {};
  for (const id of ids) {
    const list = (v as Record<string, unknown>)[id];
    if (Array.isArray(list)) out[id] = [...new Set(list.filter((u): u is string => typeof u === "string" && !!u))].slice(0, MAX_QUOTE_PHOTOS);
  }
  return out;
}

function snapshotProperty(id: string, v: FirebaseFirestore.DocumentData, chosen?: string[]): QuoteProperty {
  const s = (x: unknown) => (typeof x === "string" ? x : "");
  const n = (x: unknown) => (typeof x === "number" ? x : null);
  const operation: Operation = v.operation ?? "venta";
  const prices = { operation, salePrice: n(v.salePrice), rentPrice: n(v.rentPrice) };
  return {
    id,
    title: s(v.title) || s(v.propertyType) || "Inmueble",
    propertyType: s(v.propertyType),
    ...prices,
    price: mainPrice(prices) ?? 0,
    maintenanceFee: n(v.maintenanceFee),
    bedrooms: Number(v.bedrooms) || 0,
    bathrooms: (Number(v.bathrooms) || 0) + (Number(v.halfBathrooms) || 0) * 0.5,
    parking: Number(v.parking) || 0,
    builtArea: n(v.builtArea),
    landArea: n(v.landArea),
    location: [v.location?.neighborhood, v.location?.city].filter(Boolean).join(", "),
    amenities: (Array.isArray(v.amenities) ? v.amenities : []).slice(0, 8),
    highlights: (Array.isArray(v.highlights) ? v.highlights : []).filter((h: unknown) => typeof h === "string").slice(0, 10),
    photos: pickPhotos((Array.isArray(v.photos) ? v.photos : []).map((p: { url: string }) => p.url), chosen),
  };
}

/** Only photos the property really has (never an arbitrary URL), in the chosen order; none chosen → the first ones. */
function pickPhotos(all: string[], chosen?: string[]) {
  const picked = chosen?.filter((u) => all.includes(u)) ?? [];
  return (picked.length ? picked : all).slice(0, MAX_QUOTE_PHOTOS);
}

/** Saves the catalog with the next folio (CAT-0001…) and the properties as they are now. */
export async function createQuote(uid: string, input: QuoteInput, seller: { id: string | null; name: string }) {
  const propertySnaps = await adminDb.getAll(...input.propertyIds.map((id) => adminDb.doc(propertyDoc(uid, id))));
  const properties = propertySnaps.map((s) => {
    if (!s.exists) throw new HttpError(404, "Una de las propiedades ya no existe");
    if (["vendido", "rentado"].includes(s.get("status"))) throw new HttpError(409, `${s.get("title") || "Una propiedad"} ya está ${s.get("status")}`);
    return snapshotProperty(s.id, s.data()!, input.photos[s.id]);
  });
  let clientName = input.clientName;
  let clientWhatsapp = input.clientWhatsapp;
  if (input.clientId && (!clientName || !clientWhatsapp)) {
    const c = await adminDb.doc(clientDoc(uid, input.clientId)).get();
    clientName ||= [c.get("firstName"), c.get("lastName")].filter(Boolean).join(" ") || (c.get("displayName") as string) || "";
    clientWhatsapp ||= (c.get("whatsapp") as string | undefined) ?? "";
  }
  const defaults = await readQuoteDefaults(uid);
  const userRef = adminDb.doc(userDoc(uid));
  const ref = adminDb.collection(quotesCol(uid)).doc();
  const token = randomBytes(16).toString("base64url");
  const folio = await adminDb.runTransaction(async (tx) => {
    const n = ((await tx.get(userRef)).get("counters.quote") as number | undefined) ?? 0;
    tx.set(userRef, { counters: { quote: n + 1 } }, { merge: true });
    const folio = `CAT-${String(n + 1).padStart(4, "0")}`;
    tx.set(ref, {
      folio,
      conversationId: input.conversationId,
      clientId: input.clientId,
      clientName,
      dealId: input.dealId,
      properties,
      financing: input.financing,
      minDownPct: defaults.minDownPct,
      validDays: input.validDays,
      notes: input.notes,
      conditions: defaults.conditions,
      sellerId: seller.id,
      sellerName: seller.name,
      pdfUrl: null,
      createdAt: FieldValue.serverTimestamp(),
      token,
      allowSimulation: input.allowSimulation,
      clientWhatsapp,
      status: "sent",
      views: 0,
      firstViewedAt: null,
      lastViewedAt: null,
      accepted: null,
      bookingId: null,
    });
    tx.set(adminDb.doc(quoteTokenDoc(token)), { uid, quoteId: ref.id });
    return folio;
  });
  return { id: ref.id, folio, token };
}

export async function getQuote(uid: string, id: string): Promise<QuoteDoc & { id: string }> {
  const snap = await adminDb.doc(quoteDoc(uid, id)).get();
  if (!snap.exists) throw new HttpError(404, "Catálogo no encontrado");
  return { id: snap.id, ...(snap.data() as QuoteDoc) };
}

export const quoteFileName = (q: Pick<QuoteDoc, "folio" | "clientName">) =>
  `${q.folio}${q.clientName ? ` ${q.clientName}` : ""}.pdf`.replace(/[\\/:*?"<>|]+/g, "").slice(0, 120);

export function toQuoteRow(id: string, q: QuoteDoc) {
  const iso = (ts: Timestamp | null | undefined) => ts?.toDate?.().toISOString() ?? null;
  return {
    id,
    folio: q.folio,
    path: q.token ? quotePath(q.token) : null,
    status: quoteStatus(q),
    views: q.views ?? 0,
    lastViewedAt: iso(q.lastViewedAt),
    validUntil: validUntil(q).toISOString(),
    accepted: q.accepted ? { propertyTitle: q.accepted.propertyTitle, downPct: q.accepted.downPct, months: q.accepted.months } : null,
    clientWhatsapp: q.clientWhatsapp ?? "",
    clientId: q.clientId,
    clientName: q.clientName,
    conversationId: q.conversationId,
    properties: q.properties.map((v) => ({ id: v.id, title: v.title, price: v.price, rent: v.operation === "renta" })),
    financing: !!q.financing,
    validDays: q.validDays,
    sellerName: q.sellerName,
    pdfUrl: q.pdfUrl,
    createdAt: q.createdAt?.toDate?.().toISOString() ?? null,
  };
}
