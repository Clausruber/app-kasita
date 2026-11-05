import { NextResponse } from "next/server";
import { HttpError, withPerm } from "@/lib/auth-guard";
import { actorCan } from "@/lib/actor";
import { closeDeal, createDealFor, toDealRow } from "@/lib/deals-server";
import { adminDb } from "@/lib/firebase/admin";
import { dealDoc, dealsCol, propertyDoc } from "@/lib/firebase/paths";
import { toPropertyRow } from "@/lib/properties";

type Ctx = { params: Promise<{ id: string }> };

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * "Cerrar" (venta o renta) from Propiedades: finds the deal to close (the reservation's, or an open one
 * of the same client) or opens one, then records it with the same transaction as the pipeline (closeDeal).
 */
export const POST = withPerm<Ctx>("deals.sell", async (req, user, { params }) => {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const propertyRef = adminDb.doc(propertyDoc(user.uid, id));
  const property = await propertyRef.get();
  if (!property.exists) throw new HttpError(404, "Inmueble no encontrado");
  const status = property.get("status");
  if (status === "vendido" || status === "rentado") throw new HttpError(409, `El inmueble ya está ${status}`);
  if (status === "borrador") throw new HttpError(409, "Publica el inmueble (disponible) antes de cerrarlo");

  const clientId = clip(body.clientId, 400) || null;
  let dealId: string | null = null;
  if (status === "apartado") {
    // The reservation's deal is the one being sold; its client comes with it.
    dealId = (property.get("reservation.dealId") as string | undefined) ?? null;
  } else {
    const open = (await adminDb.collection(dealsCol(user.uid)).where("propertyId", "==", id).get()).docs.filter(
      (d) => !["vendido", "perdido"].includes(d.get("stage")),
    );
    dealId = (clientId && open.find((d) => d.get("clientId") === clientId)?.id) || null;
  }
  if (!dealId) {
    const clientName = clip(body.clientName, 120);
    if (!clientId && !clientName) throw new HttpError(400, "Indica el cliente");
    const ref = await createDealFor(user.uid, user, {
      stage: "negociacion",
      propertyId: id,
      value: Number(body.finalPrice) || Number(body.monthlyRent) || null,
      ...(clientId ? { clientId } : { clientName, clientPhone: clip(body.clientWhatsapp, 30) }),
    });
    await ref.update({ source: "Propiedades" });
    dealId = ref.id;
  }

  await closeDeal(user.uid, user, dealId, body);
  const [v, deal] = await Promise.all([propertyRef.get(), adminDb.doc(dealDoc(user.uid, dealId)).get()]);
  return NextResponse.json({ property: toPropertyRow(id, v.data()!, actorCan(user.actor, "inventory.private")), deal: toDealRow(deal.id, deal.data()!) });
});
