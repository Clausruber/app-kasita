import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpError } from "@/lib/auth-guard";
import { adminDb } from "@/lib/firebase/admin";
import { dealDoc, dealsCol, taskDoc } from "@/lib/firebase/paths";
import { quoteByToken } from "@/lib/quote-public";
import { quoteStatus, type QuoteDoc } from "@/lib/quotes-server";
import { GUARDED_STAGES, money } from "@/lib/vehicle-catalog";

type Ctx = { params: Promise<{ token: string }> };

/**
 * Public (no login): "Quiero este auto". Stores the chosen car and plan, moves (or opens) the deal to
 * negotiation and creates a follow-up for the seller. Idempotent: accepting again changes nothing.
 */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { token } = await params;
    const body = (await req.json().catch(() => ({}))) as { vehicleId?: unknown; downPct?: unknown; months?: unknown; tradeIn?: { description?: unknown; value?: unknown } | null };
    const { uid, quoteId, ref, quote } = await quoteByToken(token);
    if (quoteStatus(quote) === "expired") throw new HttpError(409, "La cotización ya venció; escríbenos por WhatsApp");
    const vehicle = quote.vehicles.find((v) => v.id === body.vehicleId);
    if (!vehicle) throw new HttpError(400, "Ese auto no está en la cotización");
    const terms = quote.financing?.terms ?? [12, 24, 36, 48, 60, 72];
    const downPct = body.downPct == null ? quote.minDownPct : Math.round(Number(body.downPct));
    if (!Number.isFinite(downPct) || downPct < quote.minDownPct || downPct > 90) throw new HttpError(400, `El enganche debe ser de ${quote.minDownPct}% a 90%`);
    const months = body.months == null ? null : Number(body.months);
    if (months !== null && !terms.includes(months)) throw new HttpError(400, "Plazo no válido");
    // Trade-in typed by the customer in the simulator (an estimate the seller confirms later).
    const tradeValue = Math.round(Number(body.tradeIn?.value));
    const tradeIn =
      body.tradeIn && Number.isFinite(tradeValue) && tradeValue > 0
        ? { description: String(body.tradeIn.description ?? "").trim().slice(0, 200), value: Math.min(tradeValue, 100_000_000) }
        : null;
    const tradeText = tradeIn ? ` · auto a cuenta: ${tradeIn.description || "sin modelo"} (${money(tradeIn.value)})` : "";

    const result = await adminDb.runTransaction(async (tx) => {
      const fresh = (await tx.get(ref)).data() as QuoteDoc;
      if (fresh.accepted) return { already: true, sameCar: fresh.accepted.vehicleId === vehicle.id };
      const dealRef = fresh.dealId ? adminDb.doc(dealDoc(uid, fresh.dealId)) : null;
      const deal = dealRef ? await tx.get(dealRef) : null;
      tx.update(ref, { status: "accepted", accepted: { vehicleId: vehicle.id, vehicleTitle: vehicle.title, downPct, months, tradeIn, at: FieldValue.serverTimestamp() } });
      let dealId = fresh.dealId;
      if (deal?.exists) {
        if (!GUARDED_STAGES.includes(deal.get("stage")))
          tx.update(deal.ref, { stage: "negociacion", vehicleId: vehicle.id, vehicleTitle: vehicle.title, value: vehicle.price, stageChangedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      } else {
        const newDeal = adminDb.collection(dealsCol(uid)).doc();
        dealId = newDeal.id;
        tx.set(newDeal, {
          stage: "negociacion",
          assigneeId: fresh.sellerId ?? null,
          source: "Cotización",
          value: vehicle.price,
          notes: `Aceptó la cotización ${fresh.folio}${months ? ` con ${downPct}% de enganche a ${months} meses` : ""}${tradeText}.`,
          lostReason: "",
          reservation: null,
          saleId: null,
          clientId: fresh.clientId ?? null,
          clientName: fresh.clientName || "Cliente de cotización",
          clientPhone: fresh.clientWhatsapp ?? "",
          vehicleId: vehicle.id,
          vehicleTitle: vehicle.title,
          createdBy: "quote",
          stageChangedAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        tx.update(ref, { dealId });
      }
      tx.set(adminDb.doc(taskDoc(uid, `quote_accepted_${quoteId}`)), {
        title: `${fresh.clientName || "Un cliente"} quiere el ${vehicle.title} (${fresh.folio})${months ? ` · ${downPct}% a ${months} meses` : ""}${tradeText}`,
        dueAt: Timestamp.now(),
        assigneeId: fresh.sellerId ?? null,
        clientId: fresh.clientId ?? null,
        dealId,
        vehicleId: vehicle.id,
        conversationId: fresh.conversationId ?? null,
        kind: "quote_accepted",
        done: false,
        doneAt: null,
        notes: "",
        createdAt: FieldValue.serverTimestamp(),
      });
      return { already: false, sameCar: true };
    });
    if (result.already && !result.sameCar) throw new HttpError(409, "Ya nos indicaste otro auto de esta cotización; escríbenos si cambiaste de opinión");
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("quote accept", e);
    return NextResponse.json({ error: "Error" }, { status: 500 });
  }
}
