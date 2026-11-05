import { randomBytes } from "crypto";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { clientDoc, propertyDoc, quoteDoc, quoteTokenDoc, quotesCol, userDoc } from "./paths";
import { authorKeyOf, clientIdOf } from "./clients";

// Quotes the AI agent creates for a commenter (sent by private reply). Same document as
// web/src/lib/quotes-server.ts createQuote — keep the fields in sync — with one property, no financing.

const db = () => getFirestore();
// Public host of /c/{token}. Same as web NEXT_PUBLIC_APP_URL in production.
const APP_URL = (process.env.APP_URL || "https://kasita-crm.web.app").replace(/\/$/, "");
const MAX_QUOTE_PHOTOS = 6;
// Defaults of web/src/lib/quote-math.ts QUOTE_DEFAULTS, used when Ajustes → Cotizaciones is empty.
const DEFAULTS = {
  minDownPct: 10,
  validDays: 15,
  conditions:
    "Precios en pesos mexicanos (MXN), sujetos a cambio sin previo aviso y a disponibilidad del inmueble. La simulación de crédito es informativa: la tasa, el plazo y el monto los define la institución financiera. No incluye gastos notariales, avalúo ni comisiones de apertura.",
};

export const quoteLink = (token: string) => `${APP_URL}/c/${token}`;

type Author = { id?: string | null; name?: string | null; username?: string | null };

function snapshotProperty(id: string, v: FirebaseFirestore.DocumentData) {
  const s = (x: unknown) => (typeof x === "string" ? x : "");
  const n = (x: unknown) => (typeof x === "number" ? x : null);
  const operation = (v.operation as string) ?? "venta";
  const salePrice = n(v.salePrice);
  const rentPrice = n(v.rentPrice);
  const forSale = operation === "venta" || operation === "venta_renta";
  return {
    id,
    title: s(v.title) || s(v.propertyType) || "Inmueble",
    propertyType: s(v.propertyType),
    operation,
    salePrice,
    rentPrice,
    price: (forSale ? salePrice : rentPrice) ?? 0,
    maintenanceFee: n(v.maintenanceFee),
    bedrooms: Number(v.bedrooms) || 0,
    bathrooms: (Number(v.bathrooms) || 0) + (Number(v.halfBathrooms) || 0) * 0.5,
    parking: Number(v.parking) || 0,
    builtArea: n(v.builtArea),
    landArea: n(v.landArea),
    location: [v.location?.neighborhood, v.location?.city].filter(Boolean).join(", "),
    amenities: (Array.isArray(v.amenities) ? v.amenities : []).slice(0, 8),
    highlights: (Array.isArray(v.highlights) ? v.highlights : []).filter((h: unknown) => typeof h === "string").slice(0, 10),
    photos: (Array.isArray(v.photos) ? v.photos : []).map((p: { url: string }) => p.url).filter(Boolean).slice(0, MAX_QUOTE_PHOTOS),
  };
}

/** Saves a one-property quote (next CAT folio) for the person behind a comment; seller = account owner. */
export async function createCommentQuote(uid: string, propertyId: string, who: { platform: string; author: Author }) {
  const [prop, user] = await Promise.all([db().doc(propertyDoc(uid, propertyId)).get(), db().doc(userDoc(uid)).get()]);
  if (!prop.exists) throw new Error("El inmueble ya no existe");
  if (["vendido", "rentado"].includes(prop.get("status"))) throw new Error(`${prop.get("title") || "El inmueble"} ya está ${prop.get("status")}`);

  const key = authorKeyOf(who.author);
  const clientRef = key && who.platform ? db().doc(clientDoc(uid, clientIdOf(who.platform, key))) : null;
  const client = clientRef ? await clientRef.get() : null;
  const clientName =
    [client?.get("firstName"), client?.get("lastName")].filter(Boolean).join(" ") || who.author.name || who.author.username || "";

  const d = (user.get("quoteDefaults") ?? {}) as Record<string, unknown>;
  const inRange = (x: unknown, min: number, max: number) => Number.isFinite(Number(x)) && Number(x) >= min && Number(x) <= max;
  const ref = db().collection(quotesCol(uid)).doc();
  const token = randomBytes(16).toString("base64url");
  const userRef = db().doc(userDoc(uid));
  const property = snapshotProperty(prop.id, prop.data()!);
  const folio = await db().runTransaction(async (tx) => {
    const n = ((await tx.get(userRef)).get("counters.quote") as number | undefined) ?? 0;
    tx.set(userRef, { counters: { quote: n + 1 } }, { merge: true });
    const folio = `CAT-${String(n + 1).padStart(4, "0")}`;
    tx.set(ref, {
      folio,
      conversationId: null,
      clientId: client?.exists ? client.id : null,
      clientName,
      dealId: null,
      properties: [property],
      financing: null,
      minDownPct: inRange(d.minDownPct, 0, 90) ? Number(d.minDownPct) : DEFAULTS.minDownPct,
      validDays: inRange(d.validDays, 1, 90) ? Math.round(Number(d.validDays)) : DEFAULTS.validDays,
      notes: "",
      conditions: typeof d.conditions === "string" ? d.conditions.trim().slice(0, 1500) : DEFAULTS.conditions,
      sellerId: "owner",
      sellerName: (user.get("displayName") as string | undefined) || "Dueño de la cuenta",
      pdfUrl: null,
      createdAt: FieldValue.serverTimestamp(),
      token,
      allowSimulation: true,
      clientWhatsapp: (client?.get("whatsapp") as string | undefined) ?? "",
      status: "sent",
      views: 0,
      firstViewedAt: null,
      lastViewedAt: null,
      accepted: null,
      bookingId: null,
      source: "ai_comment",
    });
    tx.set(db().doc(quoteTokenDoc(token)), { uid, quoteId: ref.id });
    return folio;
  });
  return { id: ref.id, folio, token, link: quoteLink(token), propertyTitle: property.title, clientName };
}

/** Undo a quote whose DM could not be sent (nobody ever got the link). The folio number is not reused. */
export async function deleteQuote(uid: string, quoteId: string, token: string) {
  const batch = db().batch();
  batch.delete(db().doc(quoteDoc(uid, quoteId)));
  batch.delete(db().doc(quoteTokenDoc(token)));
  await batch.commit();
}
