import { NextResponse } from "next/server";
import { HttpError, withPerm } from "@/lib/auth-guard";
import { actorCan } from "@/lib/actor";
import { createDealFor, sellDeal, toDealRow } from "@/lib/deals-server";
import { adminDb } from "@/lib/firebase/admin";
import { dealDoc, dealsCol, vehicleDoc } from "@/lib/firebase/paths";
import { toVehicleRow } from "@/lib/vehicles";

type Ctx = { params: Promise<{ id: string }> };

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * "Vender" from the inventory: finds the deal to close (the reservation's, or an open one of the same
 * client) or opens one, then records the sale with the same transaction as the pipeline (sellDeal).
 */
export const POST = withPerm<Ctx>("deals.sell", async (req, user, { params }) => {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const vehicleRef = adminDb.doc(vehicleDoc(user.uid, id));
  const vehicle = await vehicleRef.get();
  if (!vehicle.exists) throw new HttpError(404, "Auto no encontrado");
  const status = vehicle.get("status");
  if (status === "vendido") throw new HttpError(409, "El auto ya fue vendido");
  if (status === "borrador") throw new HttpError(409, "Publica el auto (disponible) antes de venderlo");

  const clientId = clip(body.clientId, 400) || null;
  let dealId: string | null = null;
  if (status === "apartado") {
    // The reservation's deal is the one being sold; its client comes with it.
    dealId = (vehicle.get("reservation.dealId") as string | undefined) ?? null;
  } else {
    const open = (await adminDb.collection(dealsCol(user.uid)).where("vehicleId", "==", id).get()).docs.filter(
      (d) => !["vendido", "perdido"].includes(d.get("stage")),
    );
    dealId = (clientId && open.find((d) => d.get("clientId") === clientId)?.id) || null;
  }
  if (!dealId) {
    const clientName = clip(body.clientName, 120);
    if (!clientId && !clientName) throw new HttpError(400, "Indica el cliente");
    const ref = await createDealFor(user.uid, user, {
      stage: "negociacion",
      vehicleId: id,
      value: Number(body.finalPrice) || null,
      ...(clientId ? { clientId } : { clientName, clientPhone: clip(body.clientWhatsapp, 30) }),
    });
    await ref.update({ source: "Inventario" });
    dealId = ref.id;
  }

  await sellDeal(user.uid, user, dealId, body);
  const [v, deal] = await Promise.all([vehicleRef.get(), adminDb.doc(dealDoc(user.uid, dealId)).get()]);
  return NextResponse.json({ vehicle: toVehicleRow(id, v.data()!, actorCan(user.actor, "inventory.private")), deal: toDealRow(deal.id, deal.data()!) });
});
