
import { HttpError } from "./auth-guard";
import { formatAddress, type Company } from "./company";
import { adminDb } from "./firebase/admin";
import { agendasCol, quoteDoc, quoteTokenDoc, userDoc } from "./firebase/paths";
import { QUOTE_DEFAULTS, type Financing } from "./quote-math";
import { quoteStatus, validUntil, type QuoteDoc, type QuoteStatus, type QuoteProperty } from "./quotes-server";
import { readPostImages } from "./watermark-server";

// Public quote page (/c/{token}): no login, so only what the customer should see leaves the server.

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const digits = (s: string | undefined) => (s ?? "").replace(/\D/g, "");

export type PublicQuote = {
  folio: string;
  clientName: string;
  // Only the last digits: the link can be forwarded, so the full number never leaves the server.
  clientWhatsappHint: string | null;
  sellerName: string;
  properties: QuoteProperty[];
  financing: Financing; // the seller's plan, or the defaults so the customer can still simulate
  hasFinancing: boolean;
  allowSimulation: boolean;
  minDownPct: number;
  notes: string;
  conditions: string;
  validUntil: string;
  status: QuoteStatus;
  accepted: { propertyId: string; propertyTitle: string; downPct: number | null; months: number | null } | null;
  hasBooking: boolean;
  company: { name: string; whatsapp: string; phone: string; email: string; website: string; address: string; logoUrl: string };
  visit: { agendaId: string; service: string; durationMin: number } | null;
};

/** Resolves a token to its workspace and quote; 404 for unknown tokens (never says which part failed). */
export async function quoteByToken(token: string) {
  if (!TOKEN_RE.test(token)) throw new HttpError(404, "Cotización no encontrada");
  const idx = await adminDb.doc(quoteTokenDoc(token)).get();
  const uid = idx.get("uid") as string | undefined;
  const quoteId = idx.get("quoteId") as string | undefined;
  if (!uid || !quoteId) throw new HttpError(404, "Cotización no encontrada");
  const snap = await adminDb.doc(quoteDoc(uid, quoteId)).get();
  if (!snap.exists) throw new HttpError(404, "Cotización no encontrada");
  return { uid, quoteId, ref: snap.ref, quote: snap.data() as QuoteDoc };
}

export async function toPublicQuote(uid: string, q: QuoteDoc): Promise<PublicQuote> {
  const [user, images, agendas] = await Promise.all([adminDb.doc(userDoc(uid)).get(), readPostImages(uid), adminDb.collection(agendasCol(uid)).get()]);
  const c = (user.get("company") ?? {}) as Partial<Company>;
  const defaults = (user.get("quoteDefaults") ?? {}) as Partial<typeof QUOTE_DEFAULTS>;
  const visit = agendas.docs.find((d) => d.get("active") !== false && d.get("propertyRequired"));
  const financing: Financing = q.financing ?? {
    downMode: "pct",
    down: q.minDownPct,
    rate: Number(defaults.rate) || QUOTE_DEFAULTS.rate,
    terms: Array.isArray(defaults.terms) && defaults.terms.length ? defaults.terms : QUOTE_DEFAULTS.terms,
  };
  return {
    folio: q.folio,
    clientName: q.clientName,
    clientWhatsappHint: digits(q.clientWhatsapp).length >= 8 ? digits(q.clientWhatsapp).slice(-4) : null,
    sellerName: q.sellerName,
    properties: q.properties,
    financing,
    hasFinancing: !!q.financing,
    allowSimulation: q.allowSimulation !== false,
    minDownPct: q.minDownPct,
    notes: q.notes,
    conditions: q.conditions,
    validUntil: validUntil(q).toISOString(),
    status: quoteStatus(q),
    accepted: q.accepted ? { propertyId: q.accepted.propertyId, propertyTitle: q.accepted.propertyTitle, downPct: q.accepted.downPct, months: q.accepted.months } : null,
    hasBooking: !!q.bookingId,
    company: {
      name: c.name ?? "",
      whatsapp: (c.whatsapp ?? "").replace(/[^\d]/g, ""),
      phone: c.phone ?? "",
      email: c.email ?? "",
      website: c.website ?? "",
      address: c.address ? formatAddress(c.address) : "",
      logoUrl: images.logoUrl,
    },
    visit: visit ? { agendaId: visit.id, service: (visit.get("service") as string) || "Visita a propiedad", durationMin: Number(visit.get("durationMin")) || 45 } : null,
  };
}

/** Link-preview crawlers (WhatsApp, Facebook, X…) must not count as the customer opening the quote. */
export const isPreviewBot = (ua: string | null) => !ua || /whatsapp|facebookexternalhit|facebot|twitterbot|telegrambot|slackbot|discordbot|linkedinbot|skypeuripreview|googlebot|bingbot|bot\b|crawler|spider|preview/i.test(ua);
