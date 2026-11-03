import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpError, type ApiUser } from "@/lib/auth-guard";
import { actorCan } from "@/lib/actor";
import { adminDb } from "@/lib/firebase/admin";
import { clientDoc, dealDoc, dealsCol, salesCol, taskDoc, userDoc, vehicleDoc } from "@/lib/firebase/paths";
import { listMembers } from "@/lib/team";
import { reservationOf } from "@/lib/vehicles";
import { DEAL_STAGES, GUARDED_STAGES } from "@/lib/vehicle-catalog";
import type { Deal, DealStage, PaymentMethod } from "@/lib/types";

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const iso = (v: unknown) => (v instanceof Timestamp ? v.toDate().toISOString() : null);
const STAGE_IDS = DEAL_STAGES.map((s) => s.id);

/** The acting user as a deal/task assignee: "owner" for the account owner, else their member id. */
export const sellerIdOf = (user: ApiUser) => (user.actor.isOwner ? "owner" : user.actor.memberId);

export function toDealRow(id: string, d: FirebaseFirestore.DocumentData): Deal {
  return {
    id,
    clientId: d.clientId ?? null,
    clientName: d.clientName ?? "",
    clientPhone: d.clientPhone ?? "",
    vehicleId: d.vehicleId ?? null,
    vehicleTitle: d.vehicleTitle ?? null,
    stage: STAGE_IDS.includes(d.stage) ? d.stage : "nuevo",
    assigneeId: d.assigneeId ?? null,
    source: d.source ?? "manual",
    value: typeof d.value === "number" ? d.value : null,
    notes: d.notes ?? "",
    lostReason: d.lostReason ?? "",
    reservation: reservationOf(d.reservation),
    saleId: d.saleId ?? null,
    stageChangedAt: iso(d.stageChangedAt),
    createdAt: iso(d.createdAt),
  };
}

/** Owner + active members, for the salesperson selectors (any user with Ventas can list them). */
export async function listSellers(uid: string) {
  const [owner, members] = await Promise.all([adminDb.doc(userDoc(uid)).get(), listMembers(uid)]);
  return [
    { id: "owner", name: owner.get("displayName") || "Dueño de la cuenta" },
    ...members
      .filter((m) => m.status === "active")
      .map((m) => ({ id: m.id, name: [m.firstName, m.lastName].filter(Boolean).join(" ") || m.email })),
  ];
}

/** A member without "deals.assignAll" only works with their own deals and unassigned ones. */
export function assertDealAccess(user: ApiUser, deal: FirebaseFirestore.DocumentData) {
  if (actorCan(user.actor, "deals.assignAll")) return;
  if (deal.assigneeId && deal.assigneeId !== sellerIdOf(user)) throw new HttpError(403, "Esta oportunidad es de otro vendedor");
}

/** Denormalised names so the kanban needs no joins. */
async function linked(uid: string, clientId: string | null, vehicleId: string | null) {
  const [client, vehicle] = await Promise.all([
    clientId ? adminDb.doc(clientDoc(uid, clientId)).get() : null,
    vehicleId ? adminDb.doc(vehicleDoc(uid, vehicleId)).get() : null,
  ]);
  if (clientId && !client?.exists) throw new HttpError(400, "Cliente no encontrado");
  if (vehicleId && !vehicle?.exists) throw new HttpError(400, "Auto no encontrado");
  return {
    clientName: client ? [client.get("firstName"), client.get("lastName")].filter(Boolean).join(" ") || client.get("displayName") || "" : null,
    clientPhone: client ? client.get("whatsapp") || "" : null,
    vehicleTitle: vehicle ? vehicle.get("title") || `${vehicle.get("brand")} ${vehicle.get("model")} ${vehicle.get("year")}` : null,
  };
}

/** Validates a create/edit. Apartado and vendido are only set by reserve/sell (they change the vehicle). */
export async function parseDealInput(uid: string, user: ApiUser, body: Record<string, unknown>, current?: FirebaseFirestore.DocumentData) {
  const out: Record<string, unknown> = {};
  if ("stage" in body) {
    const stage = body.stage as DealStage;
    if (!STAGE_IDS.includes(stage)) throw new HttpError(400, "Etapa no válida");
    if (GUARDED_STAGES.includes(stage) && stage !== current?.stage) throw new HttpError(400, "Usa «Apartar» o «Registrar venta» para esa etapa");
    if (current && GUARDED_STAGES.includes(current.stage) && stage !== current.stage)
      throw new HttpError(400, current.stage === "vendido" ? "Una venta registrada no se puede mover" : "Libera el apartado antes de cambiar de etapa");
    if (stage !== current?.stage) {
      out.stage = stage;
      out.stageChangedAt = FieldValue.serverTimestamp();
    }
    if (stage === "perdido") out.lostReason = clip(body.lostReason, 200);
  }
  if ("assigneeId" in body) {
    const a = body.assigneeId === null || body.assigneeId === "" ? null : String(body.assigneeId);
    if (!actorCan(user.actor, "deals.assignAll") && a !== null && a !== sellerIdOf(user)) throw new HttpError(403, "Solo puedes asignarte a ti mismo");
    out.assigneeId = a;
  }
  const clientId = "clientId" in body ? clip(body.clientId, 400) || null : (current?.clientId ?? null);
  const vehicleId = "vehicleId" in body ? clip(body.vehicleId, 100) || null : (current?.vehicleId ?? null);
  if ("vehicleId" in body && current && GUARDED_STAGES.includes(current.stage) && vehicleId !== current.vehicleId)
    throw new HttpError(400, "No se puede cambiar el auto de un apartado o venta");
  if ("clientId" in body || "vehicleId" in body || !current) {
    const l = await linked(uid, clientId, vehicleId);
    out.clientId = clientId;
    out.vehicleId = vehicleId;
    out.vehicleTitle = l.vehicleTitle;
    if (l.clientName !== null) {
      out.clientName = l.clientName;
      out.clientPhone = l.clientPhone;
    }
  }
  if ("clientName" in body && !clientId) out.clientName = clip(body.clientName, 120);
  if ("clientPhone" in body && !clientId) out.clientPhone = clip(body.clientPhone, 30);
  const noValue = body.value === undefined || body.value === null || body.value === "";
  if ("value" in body) out.value = noValue ? null : Math.max(0, Math.round(Number(body.value) || 0));
  // A new deal on a vehicle is worth its list price until someone says otherwise.
  if (noValue && out.vehicleId && (!current || !current.value)) {
    const price = (await adminDb.doc(vehicleDoc(uid, String(out.vehicleId))).get()).get("price");
    if (typeof price === "number") out.value = price;
  }
  if ("notes" in body) out.notes = clip(body.notes, 2000);
  if (!current && !out.clientName) throw new HttpError(400, "Indica el cliente");
  return out;
}

// ---- Apartados y ventas: one transaction keeps vehicle, deal and sale consistent ----

const dateOf = (v: unknown, label: string) => {
  const d = new Date(String(v ?? ""));
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `${label} no válida`);
  return d;
};

export async function reserveDeal(uid: string, user: ApiUser, dealId: string, body: Record<string, unknown>) {
  const amount = Math.round(Number(body.amount));
  if (!Number.isFinite(amount) || amount < 0) throw new HttpError(400, "Anticipo no válido");
  const expiresAt = dateOf(body.expiresAt, "Fecha de vencimiento");
  if (expiresAt.getTime() < Date.now()) throw new HttpError(400, "El apartado debe vencer en el futuro");
  const dealRef = adminDb.doc(dealDoc(uid, dealId));
  await adminDb.runTransaction(async (tx) => {
    const deal = await tx.get(dealRef);
    if (!deal.exists) throw new HttpError(404, "Oportunidad no encontrada");
    assertDealAccess(user, deal.data()!);
    if (GUARDED_STAGES.includes(deal.get("stage"))) throw new HttpError(409, "Esta oportunidad ya está apartada o vendida");
    const vehicleId = deal.get("vehicleId");
    if (!vehicleId) throw new HttpError(400, "Asigna un auto a la oportunidad antes de apartarlo");
    const vehicleRef = adminDb.doc(vehicleDoc(uid, vehicleId));
    const vehicle = await tx.get(vehicleRef);
    if (!vehicle.exists) throw new HttpError(404, "Auto no encontrado");
    if (vehicle.get("status") !== "disponible") throw new HttpError(409, `El auto está ${vehicle.get("status")}; no se puede apartar`);
    const reservation = { dealId, amount, at: Timestamp.now(), expiresAt: Timestamp.fromDate(expiresAt) };
    tx.update(vehicleRef, { status: "apartado", reservation, updatedAt: FieldValue.serverTimestamp() });
    tx.update(dealRef, { stage: "apartado", reservation, stageChangedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    // Deterministic id: re-reserving the same deal replaces the reminder instead of duplicating it.
    tx.set(adminDb.doc(taskDoc(uid, `reservation_${dealId}`)), {
      title: `Vence apartado: ${deal.get("vehicleTitle") ?? "auto"} (${deal.get("clientName")})`,
      notes: "",
      dueAt: Timestamp.fromDate(expiresAt),
      done: false,
      doneAt: null,
      assigneeId: deal.get("assigneeId") ?? sellerIdOf(user),
      clientId: deal.get("clientId") ?? null,
      dealId,
      vehicleId,
      conversationId: null,
      kind: "reservation_expiry",
      createdAt: FieldValue.serverTimestamp(),
    });
  });
}

export async function releaseDeal(uid: string, user: ApiUser, dealId: string) {
  const dealRef = adminDb.doc(dealDoc(uid, dealId));
  await adminDb.runTransaction(async (tx) => {
    const deal = await tx.get(dealRef);
    if (!deal.exists) throw new HttpError(404, "Oportunidad no encontrada");
    assertDealAccess(user, deal.data()!);
    if (deal.get("stage") !== "apartado") throw new HttpError(409, "La oportunidad no está apartada");
    const vehicleRef = deal.get("vehicleId") ? adminDb.doc(vehicleDoc(uid, deal.get("vehicleId"))) : null;
    const vehicle = vehicleRef ? await tx.get(vehicleRef) : null;
    const reminder = await tx.get(adminDb.doc(taskDoc(uid, `reservation_${dealId}`)));
    // Only release the vehicle if this deal is the one holding it.
    if (vehicleRef && vehicle?.exists && vehicle.get("status") === "apartado" && vehicle.get("reservation.dealId") === dealId)
      tx.update(vehicleRef, { status: "disponible", reservation: null, updatedAt: FieldValue.serverTimestamp() });
    tx.update(dealRef, { stage: "negociacion", reservation: null, stageChangedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    if (reminder.exists) tx.update(reminder.ref, { done: true, doneAt: FieldValue.serverTimestamp() });
  });
}

const PAYMENTS: PaymentMethod[] = ["contado", "credito", "financiera"];

export async function sellDeal(uid: string, user: ApiUser, dealId: string, body: Record<string, unknown>) {
  const finalPrice = Math.round(Number(body.finalPrice));
  if (!Number.isFinite(finalPrice) || finalPrice <= 0) throw new HttpError(400, "Precio final no válido");
  const paymentMethod = body.paymentMethod as PaymentMethod;
  if (!PAYMENTS.includes(paymentMethod)) throw new HttpError(400, "Forma de pago no válida");
  const soldAt = body.soldAt ? dateOf(body.soldAt, "Fecha de venta") : new Date();
  const sellerId = clip(body.sellerId, 100) || sellerIdOf(user);
  const downPayment = body.downPayment ? Math.max(0, Math.round(Number(body.downPayment) || 0)) : null;
  const dealRef = adminDb.doc(dealDoc(uid, dealId));
  const pre = await dealRef.get();
  if (!pre.exists) throw new HttpError(404, "Oportunidad no encontrada");
  const vehicleId = pre.get("vehicleId") as string | null;
  if (!vehicleId) throw new HttpError(400, "Asigna un auto a la oportunidad antes de venderlo");
  // Other open deals on the same vehicle are closed as lost; transactions need every read first.
  const others = (await adminDb.collection(dealsCol(uid)).where("vehicleId", "==", vehicleId).get()).docs.filter(
    (d) => d.id !== dealId && !["vendido", "perdido"].includes(d.get("stage")),
  );
  const saleRef = adminDb.collection(salesCol(uid)).doc();
  await adminDb.runTransaction(async (tx) => {
    const deal = await tx.get(dealRef);
    assertDealAccess(user, deal.data()!);
    if (deal.get("stage") === "vendido") throw new HttpError(409, "Esta oportunidad ya está vendida");
    if (deal.get("vehicleId") !== vehicleId) throw new HttpError(409, "La oportunidad cambió; recarga e inténtalo de nuevo");
    const vehicleRef = adminDb.doc(vehicleDoc(uid, vehicleId));
    const vehicle = await tx.get(vehicleRef);
    const reminder = await tx.get(adminDb.doc(taskDoc(uid, `reservation_${dealId}`)));
    if (!vehicle.exists) throw new HttpError(404, "Auto no encontrado");
    const st = vehicle.get("status");
    if (st === "vendido") throw new HttpError(409, "El auto ya fue vendido");
    if (st === "apartado" && vehicle.get("reservation.dealId") !== dealId) throw new HttpError(409, "El auto está apartado por otra oportunidad");
    const now = FieldValue.serverTimestamp();
    tx.set(saleRef, {
      dealId,
      vehicleId,
      vehicleTitle: vehicle.get("title") ?? deal.get("vehicleTitle") ?? "",
      clientId: deal.get("clientId") ?? null,
      clientName: deal.get("clientName") ?? "",
      listPrice: vehicle.get("price") ?? null,
      finalPrice,
      currency: "MXN",
      sellerId,
      paymentMethod,
      financier: paymentMethod === "financiera" ? clip(body.financier, 80) : "",
      downPayment,
      reservationAmount: vehicle.get("reservation.amount") ?? null,
      soldAt: Timestamp.fromDate(soldAt),
      createdBy: user.actor.authUid,
      createdAt: now,
    });
    // A sold car is no longer anyone's to show: the "Bloquear" notice goes too.
    tx.update(vehicleRef, { status: "vendido", soldAt: Timestamp.fromDate(soldAt), hold: FieldValue.delete(), updatedAt: now });
    tx.update(dealRef, { stage: "vendido", saleId: saleRef.id, value: finalPrice, assigneeId: deal.get("assigneeId") ?? sellerId, stageChangedAt: now, updatedAt: now });
    for (const o of others) tx.update(o.ref, { stage: "perdido", lostReason: "Auto vendido a otro cliente", stageChangedAt: now, updatedAt: now });
    if (reminder.exists) tx.update(reminder.ref, { done: true, doneAt: now });
  });
  return saleRef.id;
}

/** Creates a deal (same defaults as the pipeline's "Nueva oportunidad") and returns its id. */
export async function createDealFor(uid: string, user: ApiUser, body: Record<string, unknown>) {
  const data = await parseDealInput(uid, user, { stage: "nuevo", assigneeId: sellerIdOf(user), ...body });
  const ref = adminDb.collection(dealsCol(uid)).doc();
  await ref.set({
    stage: "nuevo",
    assigneeId: null,
    source: "manual",
    value: null,
    notes: "",
    lostReason: "",
    reservation: null,
    saleId: null,
    clientPhone: "",
    ...data,
    createdBy: user.actor.authUid,
    stageChangedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return ref;
}
