import "server-only";

import { randomBytes } from "crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpError } from "@/lib/auth-guard";
import { adminDb } from "@/lib/firebase/admin";
import { clientDoc, quoteDoc, quoteTokenDoc, quotesCol, userDoc, vehicleDoc } from "@/lib/firebase/paths";
import { MAX_CATALOG_VEHICLES, QUOTE_DEFAULTS, TERM_OPTIONS, type Financing, type QuoteDefaults, type TradeIn } from "@/lib/quote-math";

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown, min: number, max: number, name: string) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${name} debe estar entre ${min} y ${max}`);
  return n;
};

/** What the PDF shows of each car, frozen when the catalog is generated (never VIN or plates). */
export type QuoteVehicle = {
  id: string;
  title: string;
  brand: string;
  model: string;
  trim: string;
  year: number;
  km: number;
  price: number;
  condition: string;
  transmission: string;
  fuel: string;
  bodyType: string;
  color: string;
  engine: string;
  location: string;
  features: string[];
  photos: string[]; // up to 3
};

export type QuoteDoc = {
  folio: string;
  conversationId: string | null;
  clientId: string | null;
  clientName: string;
  dealId: string | null;
  vehicles: QuoteVehicle[];
  financing: Financing | null;
  tradeIn: TradeIn | null;
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
  accepted?: { vehicleId: string; vehicleTitle: string; downPct: number; months: number | null; tradeIn?: { description: string; value: number } | null; at: Timestamp } | null;
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
    ivaOnInterest: typeof v?.ivaOnInterest === "boolean" ? v.ivaOnInterest : d.ivaOnInterest,
    validDays: Math.round(n(v?.validDays, d.validDays, 1, 90)),
    conditions: typeof v?.conditions === "string" ? v.conditions.trim().slice(0, 1500) : d.conditions,
  };
}

export async function readQuoteDefaults(uid: string) {
  return parseQuoteDefaults((await adminDb.doc(userDoc(uid)).get()).get("quoteDefaults"));
}

export type QuoteInput = {
  vehicleIds: string[];
  conversationId: string | null;
  clientId: string | null;
  clientName: string;
  dealId: string | null;
  financing: Financing | null;
  tradeIn: TradeIn | null;
  validDays: number;
  notes: string;
  allowSimulation: boolean;
  clientWhatsapp: string;
};

export function parseQuoteInput(b: Record<string, unknown>): QuoteInput {
  const ids = Array.isArray(b.vehicleIds) ? [...new Set(b.vehicleIds.filter((x): x is string => typeof x === "string" && !!x && !x.includes("/")))] : [];
  if (!ids.length) throw new HttpError(400, "Agrega al menos un auto");
  if (ids.length > MAX_CATALOG_VEHICLES) throw new HttpError(400, `Máximo ${MAX_CATALOG_VEHICLES} autos por catálogo`);
  const f = b.financing as Record<string, unknown> | null | undefined;
  let financing: Financing | null = null;
  if (f) {
    const downMode = f.downMode === "amount" ? "amount" : "pct";
    const terms = (Array.isArray(f.terms) ? f.terms.map(Number) : []).filter((t) => (TERM_OPTIONS as readonly number[]).includes(t));
    if (!terms.length) throw new HttpError(400, "Elige al menos un plazo");
    financing = {
      downMode,
      down: downMode === "pct" ? num(f.down ?? 0, 0, 100, "El enganche (%)") : num(f.down ?? 0, 0, 100_000_000, "El enganche"),
      rate: num(f.rate ?? 0, 0, 100, "La tasa"),
      terms: [...new Set(terms)].sort((x, y) => x - y),
      ivaOnInterest: f.ivaOnInterest !== false,
    };
  }
  const t = b.tradeIn as Record<string, unknown> | null | undefined;
  const tradeIn = t && Number(t.value) > 0 ? { description: clip(t.description, 200), value: num(t.value, 0, 100_000_000, "El valor del auto a cuenta") } : null;
  const id = (v: unknown) => (typeof v === "string" && v && !v.includes("/") ? v.slice(0, 200) : null);
  return {
    vehicleIds: ids,
    conversationId: id(b.conversationId),
    clientId: id(b.clientId),
    clientName: clip(b.clientName, 120),
    dealId: id(b.dealId),
    financing,
    tradeIn,
    validDays: Math.round(num(b.validDays ?? QUOTE_DEFAULTS.validDays, 1, 90, "La vigencia")),
    notes: clip(b.notes, 1000),
    allowSimulation: b.allowSimulation !== false,
    clientWhatsapp: clip(b.clientWhatsapp, 30).replace(/[^\d+]/g, ""),
  };
}

function snapshotVehicle(id: string, v: FirebaseFirestore.DocumentData): QuoteVehicle {
  const s = (x: unknown) => (typeof x === "string" ? x : "");
  return {
    id,
    title: s(v.title) || [v.brand, v.model, v.year].filter(Boolean).join(" "),
    brand: s(v.brand),
    model: s(v.model),
    trim: s(v.trim),
    year: Number(v.year) || 0,
    km: Number(v.km) || 0,
    price: Number(v.price) || 0,
    condition: v.condition === "nuevo" ? "Nuevo" : "Seminuevo",
    transmission: s(v.transmission),
    fuel: s(v.fuel),
    bodyType: s(v.bodyType),
    color: s(v.color),
    engine: s(v.engine),
    location: [v.location?.city, v.location?.state].filter(Boolean).join(", "),
    features: (Array.isArray(v.features) ? v.features : []).slice(0, 8),
    photos: (Array.isArray(v.photos) ? v.photos : []).slice(0, 3).map((p: { url: string }) => p.url),
  };
}

/** Saves the catalog with the next folio (CAT-0001…) and the cars as they are now. */
export async function createQuote(uid: string, input: QuoteInput, seller: { id: string | null; name: string }) {
  const vehicleSnaps = await adminDb.getAll(...input.vehicleIds.map((id) => adminDb.doc(vehicleDoc(uid, id))));
  const vehicles = vehicleSnaps.map((s) => {
    if (!s.exists) throw new HttpError(404, "Uno de los autos ya no existe");
    if (s.get("status") === "vendido") throw new HttpError(409, `${s.get("title") || "Un auto"} ya se vendió`);
    return snapshotVehicle(s.id, s.data()!);
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
      vehicles,
      financing: input.financing,
      tradeIn: input.tradeIn,
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
    accepted: q.accepted ? { vehicleTitle: q.accepted.vehicleTitle, downPct: q.accepted.downPct, months: q.accepted.months, tradeIn: q.accepted.tradeIn ?? null } : null,
    clientWhatsapp: q.clientWhatsapp ?? "",
    clientId: q.clientId,
    clientName: q.clientName,
    conversationId: q.conversationId,
    vehicles: q.vehicles.map((v) => ({ id: v.id, title: v.title, price: v.price })),
    financing: !!q.financing,
    validDays: q.validDays,
    sellerName: q.sellerName,
    pdfUrl: q.pdfUrl,
    createdAt: q.createdAt?.toDate?.().toISOString() ?? null,
  };
}
