
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpError, type ApiUser } from "./auth-guard";
import { actorCan } from "./actor";
import { adminDb } from "./firebase/admin";
import { clientDoc, dealDoc, dealsCol, salesCol, taskDoc, userDoc, propertyDoc } from "./firebase/paths";
import { listMembers } from "./team";
import { reservationOf } from "./properties";
import { DEAL_STAGES, GUARDED_STAGES, forRent, forSale, mainPrice } from "./property-catalog";
import type { CloseKind, Deal, DealStage, Operation, PaymentMethod } from "./types";

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
    propertyId: d.propertyId ?? null,
    propertyTitle: d.propertyTitle ?? null,
    stage: STAGE_IDS.includes(d.stage) ? d.stage : "nuevo",
    assigneeId: d.assigneeId ?? null,
    source: d.source ?? "manual",
    value: typeof d.value === "number" ? d.value : null,
    notes: d.notes ?? "",
    lostReason: d.lostReason ?? "",
    reservation: reservationOf(d.reservation),
    saleId: d.saleId ?? null,
    closedAs: d.closedAs ?? null,
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
  if (deal.assigneeId && deal.assigneeId !== sellerIdOf(user)) throw new HttpError(403, "Esta oportunidad es de otro asesor");
}

/** Denormalised names so the kanban needs no joins. */
async function linked(uid: string, clientId: string | null, propertyId: string | null) {
  const [client, property] = await Promise.all([
    clientId ? adminDb.doc(clientDoc(uid, clientId)).get() : null,
    propertyId ? adminDb.doc(propertyDoc(uid, propertyId)).get() : null,
  ]);
  if (clientId && !client?.exists) throw new HttpError(400, "Cliente no encontrado");
  if (propertyId && !property?.exists) throw new HttpError(400, "Inmueble no encontrado");
  return {
    clientName: client ? [client.get("firstName"), client.get("lastName")].filter(Boolean).join(" ") || client.get("displayName") || "" : null,
    clientPhone: client ? client.get("whatsapp") || "" : null,
    propertyTitle: property ? property.get("title") || property.get("propertyType") || "Inmueble" : null,
  };
}

/** Validates a create/edit. Apartado and vendido (cerrado) are only set by reserve/close (they change the property). */
export async function parseDealInput(uid: string, user: ApiUser, body: Record<string, unknown>, current?: FirebaseFirestore.DocumentData) {
  const out: Record<string, unknown> = {};
  if ("stage" in body) {
    const stage = body.stage as DealStage;
    if (!STAGE_IDS.includes(stage)) throw new HttpError(400, "Etapa no válida");
    if (GUARDED_STAGES.includes(stage) && stage !== current?.stage) throw new HttpError(400, "Usa «Apartar» o «Cerrar operación» para esa etapa");
    if (current && GUARDED_STAGES.includes(current.stage) && stage !== current.stage)
      throw new HttpError(400, current.stage === "vendido" ? "Una operación cerrada no se puede mover" : "Libera el apartado antes de cambiar de etapa");
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
  const propertyId = "propertyId" in body ? clip(body.propertyId, 100) || null : (current?.propertyId ?? null);
  if ("propertyId" in body && current && GUARDED_STAGES.includes(current.stage) && propertyId !== current.propertyId)
    throw new HttpError(400, "No se puede cambiar el inmueble de un apartado u operación cerrada");
  if ("clientId" in body || "propertyId" in body || !current) {
    const l = await linked(uid, clientId, propertyId);
    out.clientId = clientId;
    out.propertyId = propertyId;
    out.propertyTitle = l.propertyTitle;
    if (l.clientName !== null) {
      out.clientName = l.clientName;
      out.clientPhone = l.clientPhone;
    }
  }
  if ("clientName" in body && !clientId) out.clientName = clip(body.clientName, 120);
  if ("clientPhone" in body && !clientId) out.clientPhone = clip(body.clientPhone, 30);
  const noValue = body.value === undefined || body.value === null || body.value === "";
  if ("value" in body) out.value = noValue ? null : Math.max(0, Math.round(Number(body.value) || 0));
  // A new deal on a property is worth its list price until someone says otherwise.
  if (noValue && out.propertyId && (!current || !current.value)) {
    const p = (await adminDb.doc(propertyDoc(uid, String(out.propertyId))).get()).data();
    const price = p ? mainPrice({ operation: p.operation ?? "venta", salePrice: p.salePrice ?? null, rentPrice: p.rentPrice ?? null }) : null;
    if (typeof price === "number") out.value = price;
  }
  if ("notes" in body) out.notes = clip(body.notes, 2000);
  if (!current && !out.clientName) throw new HttpError(400, "Indica el cliente");
  return out;
}

// ---- Apartados y cierres (venta o renta): one transaction keeps property, deal and sale consistent ----

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
    if (GUARDED_STAGES.includes(deal.get("stage"))) throw new HttpError(409, "Esta oportunidad ya está apartada o cerrada");
    const propertyId = deal.get("propertyId");
    if (!propertyId) throw new HttpError(400, "Asigna un inmueble a la oportunidad antes de apartarlo");
    const propertyRef = adminDb.doc(propertyDoc(uid, propertyId));
    const property = await tx.get(propertyRef);
    if (!property.exists) throw new HttpError(404, "Inmueble no encontrado");
    if (property.get("status") !== "disponible") throw new HttpError(409, `El inmueble está ${property.get("status")}; no se puede apartar`);
    const reservation = { dealId, amount, at: Timestamp.now(), expiresAt: Timestamp.fromDate(expiresAt) };
    tx.update(propertyRef, { status: "apartado", reservation, updatedAt: FieldValue.serverTimestamp() });
    tx.update(dealRef, { stage: "apartado", reservation, stageChangedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    // Deterministic id: re-reserving the same deal replaces the reminder instead of duplicating it.
    tx.set(adminDb.doc(taskDoc(uid, `reservation_${dealId}`)), {
      title: `Vence apartado: ${deal.get("propertyTitle") ?? "inmueble"} (${deal.get("clientName")})`,
      notes: "",
      dueAt: Timestamp.fromDate(expiresAt),
      done: false,
      doneAt: null,
      assigneeId: deal.get("assigneeId") ?? sellerIdOf(user),
      clientId: deal.get("clientId") ?? null,
      dealId,
      propertyId,
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
    const propertyRef = deal.get("propertyId") ? adminDb.doc(propertyDoc(uid, deal.get("propertyId"))) : null;
    const property = propertyRef ? await tx.get(propertyRef) : null;
    const reminder = await tx.get(adminDb.doc(taskDoc(uid, `reservation_${dealId}`)));
    // Only release the property if this deal is the one holding it.
    if (propertyRef && property?.exists && property.get("status") === "apartado" && property.get("reservation.dealId") === dealId)
      tx.update(propertyRef, { status: "disponible", reservation: null, updatedAt: FieldValue.serverTimestamp() });
    tx.update(dealRef, { stage: "negociacion", reservation: null, stageChangedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    if (reminder.exists) tx.update(reminder.ref, { done: true, doneAt: FieldValue.serverTimestamp() });
  });
}

const PAYMENTS: PaymentMethod[] = ["contado", "hipotecario", "infonavit", "cofinanciamiento"];

const amountOf = (v: unknown, label: string) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n <= 0) throw new HttpError(400, `${label} no válido`);
  return n;
};

/**
 * Closes a deal as a sale (property → vendido) or a rental (property → rentado, with the lease terms).
 * Also records the operation in `sales`, closes the other open deals on the property as lost and, for a
 * rental, schedules a reminder 30 days before the lease ends.
 */
export async function closeDeal(uid: string, user: ApiUser, dealId: string, body: Record<string, unknown>) {
  const kind: CloseKind = body.kind === "renta" ? "renta" : "venta";
  const closedAt = body.closedAt ? dateOf(body.closedAt, "Fecha de cierre") : new Date();
  const sellerId = clip(body.sellerId, 100) || sellerIdOf(user);
  let terms: Record<string, unknown>;
  let value: number;
  let lease: { dealId: string; monthlyRent: number; deposit: number; months: number; start: Timestamp; end: Timestamp } | null = null;
  if (kind === "venta") {
    const finalPrice = amountOf(body.finalPrice, "Precio final");
    const paymentMethod = body.paymentMethod as PaymentMethod;
    if (!PAYMENTS.includes(paymentMethod)) throw new HttpError(400, "Forma de pago no válida");
    terms = {
      finalPrice,
      paymentMethod,
      financier: paymentMethod === "contado" ? "" : clip(body.financier, 80),
      downPayment: body.downPayment ? Math.max(0, Math.round(Number(body.downPayment) || 0)) : null,
    };
    value = finalPrice;
  } else {
    const monthlyRent = amountOf(body.monthlyRent, "Renta mensual");
    const months = Math.round(Number(body.months));
    if (!Number.isFinite(months) || months < 1 || months > 120) throw new HttpError(400, "Plazo del contrato no válido");
    const deposit = Math.max(0, Math.round(Number(body.deposit) || 0));
    const start = body.leaseStart ? dateOf(body.leaseStart, "Fecha de inicio") : closedAt;
    const end = new Date(start);
    end.setMonth(end.getMonth() + months);
    lease = { dealId, monthlyRent, deposit, months, start: Timestamp.fromDate(start), end: Timestamp.fromDate(end) };
    terms = { monthlyRent, deposit, months, leaseStart: lease.start, leaseEnd: lease.end };
    value = monthlyRent;
  }
  const dealRef = adminDb.doc(dealDoc(uid, dealId));
  const pre = await dealRef.get();
  if (!pre.exists) throw new HttpError(404, "Oportunidad no encontrada");
  const propertyId = pre.get("propertyId") as string | null;
  if (!propertyId) throw new HttpError(400, "Asigna un inmueble a la oportunidad antes de cerrarla");
  // Other open deals on the same property are closed as lost; transactions need every read first.
  const others = (await adminDb.collection(dealsCol(uid)).where("propertyId", "==", propertyId).get()).docs.filter(
    (d) => d.id !== dealId && !["vendido", "perdido"].includes(d.get("stage")),
  );
  const saleRef = adminDb.collection(salesCol(uid)).doc();
  await adminDb.runTransaction(async (tx) => {
    const deal = await tx.get(dealRef);
    assertDealAccess(user, deal.data()!);
    if (deal.get("stage") === "vendido") throw new HttpError(409, "Esta oportunidad ya está cerrada");
    if (deal.get("propertyId") !== propertyId) throw new HttpError(409, "La oportunidad cambió; recarga e inténtalo de nuevo");
    const propertyRef = adminDb.doc(propertyDoc(uid, propertyId));
    const property = await tx.get(propertyRef);
    const reminder = await tx.get(adminDb.doc(taskDoc(uid, `reservation_${dealId}`)));
    if (!property.exists) throw new HttpError(404, "Inmueble no encontrado");
    const st = property.get("status");
    if (st === "vendido" || st === "rentado") throw new HttpError(409, `El inmueble ya está ${st}`);
    if (st === "apartado" && property.get("reservation.dealId") !== dealId) throw new HttpError(409, "El inmueble está apartado por otra oportunidad");
    const operation = (property.get("operation") ?? "venta") as Operation;
    if (kind === "venta" && !forSale(operation)) throw new HttpError(400, "Este inmueble solo se ofrece en renta");
    if (kind === "renta" && !forRent(operation)) throw new HttpError(400, "Este inmueble solo se ofrece en venta");
    const now = FieldValue.serverTimestamp();
    tx.set(saleRef, {
      kind,
      dealId,
      propertyId,
      propertyTitle: property.get("title") ?? deal.get("propertyTitle") ?? "",
      clientId: deal.get("clientId") ?? null,
      clientName: deal.get("clientName") ?? "",
      listPrice: (kind === "venta" ? property.get("salePrice") : property.get("rentPrice")) ?? null,
      ...terms,
      currency: "MXN",
      sellerId,
      reservationAmount: property.get("reservation.amount") ?? null,
      closedAt: Timestamp.fromDate(closedAt),
      createdBy: user.actor.authUid,
      createdAt: now,
    });
    // A closed property is no longer anyone's to show: the "Bloquear" notice goes too.
    tx.update(propertyRef, {
      status: kind === "venta" ? "vendido" : "rentado",
      closedAt: Timestamp.fromDate(closedAt),
      lease,
      reservation: null,
      hold: FieldValue.delete(),
      updatedAt: now,
    });
    tx.update(dealRef, { stage: "vendido", closedAs: kind, saleId: saleRef.id, value, assigneeId: deal.get("assigneeId") ?? sellerId, stageChangedAt: now, updatedAt: now });
    const lostReason = kind === "venta" ? "Inmueble vendido a otro cliente" : "Inmueble rentado a otro cliente";
    for (const o of others) tx.update(o.ref, { stage: "perdido", lostReason, stageChangedAt: now, updatedAt: now });
    if (reminder.exists) tx.update(reminder.ref, { done: true, doneAt: now });
    if (lease) {
      const end = lease.end.toDate();
      tx.set(adminDb.doc(taskDoc(uid, `lease_${dealId}`)), {
        title: `Termina contrato de renta: ${property.get("title") ?? "inmueble"} (${deal.get("clientName")})`,
        notes: `El contrato vence el ${end.toLocaleDateString("es-MX", { timeZone: "America/Mexico_City" })}. Renueva o vuelve a publicar el inmueble.`,
        dueAt: Timestamp.fromMillis(Math.max(Date.now(), end.getTime() - 30 * 86_400_000)),
        done: false,
        doneAt: null,
        assigneeId: deal.get("assigneeId") ?? sellerId,
        clientId: deal.get("clientId") ?? null,
        dealId,
        propertyId,
        conversationId: null,
        kind: "lease_end",
        createdAt: now,
      });
    }
  });
  return saleRef.id;
}

/** "Volver a disponible": a rented property whose lease ended goes back on the market. */
export async function relistProperty(uid: string, propertyId: string) {
  const ref = adminDb.doc(propertyDoc(uid, propertyId));
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpError(404, "Inmueble no encontrado");
    if (snap.get("status") !== "rentado") throw new HttpError(409, "Solo un inmueble rentado puede volver a estar disponible");
    const dealId = snap.get("lease.dealId") as string | undefined;
    const task = dealId ? await tx.get(adminDb.doc(taskDoc(uid, `lease_${dealId}`))) : null;
    tx.update(ref, { status: "disponible", lease: null, closedAt: null, intakeDate: Timestamp.now(), updatedAt: FieldValue.serverTimestamp() });
    if (task?.exists && !task.get("done")) tx.update(task.ref, { done: true, doneAt: FieldValue.serverTimestamp() });
  });
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
    closedAs: null,
    clientPhone: "",
    ...data,
    createdBy: user.actor.authUid,
    stageChangedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return ref;
}
