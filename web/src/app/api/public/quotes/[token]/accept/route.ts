import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpError } from "@/lib/auth-guard";
import { adminDb } from "@/lib/firebase/admin";
import { dealDoc, dealsCol, taskDoc } from "@/lib/firebase/paths";
import { quoteByToken } from "@/lib/quote-public";
import { quoteStatus, type QuoteDoc } from "@/lib/quotes-server";
import { GUARDED_STAGES, forSale } from "@/lib/property-catalog";
import { TERM_OPTIONS } from "@/lib/quote-math";

type Ctx = { params: Promise<{ token: string }> };

/**
 * Public (no login): "Me interesa este inmueble". Stores the chosen property and (for a sale) the credit plan, moves (or opens) the deal to
 * negotiation and creates a follow-up for the seller. Idempotent: accepting again changes nothing.
 */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { token } = await params;
    const body = (await req.json().catch(() => ({}))) as { propertyId?: unknown; downPct?: unknown; months?: unknown };
    const { uid, quoteId, ref, quote } = await quoteByToken(token);
    if (quoteStatus(quote) === "expired") throw new HttpError(409, "La cotización ya venció; escríbenos por WhatsApp");
    const property = quote.properties.find((v) => v.id === body.propertyId);
    if (!property) throw new HttpError(400, "Ese inmueble no está en la cotización");
    // The credit plan only applies to properties for sale; a rental is just "me interesa".
    const sale = forSale(property.operation ?? "venta");
    const terms: number[] = quote.financing?.terms ?? [...TERM_OPTIONS];
    const months = !sale || body.months == null ? null : Number(body.months);
    if (months !== null && !terms.includes(months)) throw new HttpError(400, "Plazo no válido");
    const downPct = !sale ? null : body.downPct == null ? quote.minDownPct : Math.round(Number(body.downPct));
    if (downPct !== null && (!Number.isFinite(downPct) || downPct < quote.minDownPct || downPct > 90))
      throw new HttpError(400, `El enganche debe ser de ${quote.minDownPct}% a 90%`);
    const plan = months ? ` con ${downPct}% de enganche a ${months / 12} años` : "";

    const result = await adminDb.runTransaction(async (tx) => {
      const fresh = (await tx.get(ref)).data() as QuoteDoc;
      if (fresh.accepted) return { already: true, same: fresh.accepted.propertyId === property.id };
      const dealRef = fresh.dealId ? adminDb.doc(dealDoc(uid, fresh.dealId)) : null;
      const deal = dealRef ? await tx.get(dealRef) : null;
      tx.update(ref, { status: "accepted", accepted: { propertyId: property.id, propertyTitle: property.title, downPct, months, at: FieldValue.serverTimestamp() } });
      let dealId = fresh.dealId;
      if (deal?.exists) {
        if (!GUARDED_STAGES.includes(deal.get("stage")))
          tx.update(deal.ref, { stage: "negociacion", propertyId: property.id, propertyTitle: property.title, value: property.price, stageChangedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      } else {
        const newDeal = adminDb.collection(dealsCol(uid)).doc();
        dealId = newDeal.id;
        tx.set(newDeal, {
          stage: "negociacion",
          assigneeId: fresh.sellerId ?? null,
          source: "Cotización",
          value: property.price,
          notes: `Le interesa una propiedad de la cotización ${fresh.folio}${plan}.`,
          lostReason: "",
          reservation: null,
          saleId: null,
          closedAs: null,
          clientId: fresh.clientId ?? null,
          clientName: fresh.clientName || "Cliente de cotización",
          clientPhone: fresh.clientWhatsapp ?? "",
          propertyId: property.id,
          propertyTitle: property.title,
          createdBy: "quote",
          stageChangedAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        tx.update(ref, { dealId });
      }
      tx.set(adminDb.doc(taskDoc(uid, `quote_accepted_${quoteId}`)), {
        title: `${fresh.clientName || "Un cliente"} está interesado en ${property.title} (${fresh.folio})${plan}`,
        dueAt: Timestamp.now(),
        assigneeId: fresh.sellerId ?? null,
        clientId: fresh.clientId ?? null,
        dealId,
        propertyId: property.id,
        conversationId: fresh.conversationId ?? null,
        kind: "quote_accepted",
        done: false,
        doneAt: null,
        notes: "",
        createdAt: FieldValue.serverTimestamp(),
      });
      return { already: false, same: true };
    });
    if (result.already && !result.same) throw new HttpError(409, "Ya nos indicaste otra propiedad de esta cotización; escríbenos si cambiaste de opinión");
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("quote accept", e);
    return NextResponse.json({ error: "Error" }, { status: 500 });
  }
}
