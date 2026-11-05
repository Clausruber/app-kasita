import { Router, Response } from "express";
import { Timestamp, FieldValue, getFirestore } from "firebase-admin/firestore";
import { authRequired, AuthenticatedRequest } from "../api_middleware";
import { can } from "../lib/permissions";
import { dealsCol, dealDoc } from "../paths";
import {
  createDealFor,
  listSellers,
  sellerIdOf,
  toDealRow,
  assertDealAccess,
  parseDealInput,
  reserveDeal,
  releaseDeal,
  closeDeal,
} from "../lib/deals-server";

export const dealsRouter = Router();

const CLOSED_DAYS = 30;

dealsRouter.get("/", authRequired({ perm: "deals" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const all = can(user.actor.perms, "deals.assignAll");
    const me = sellerIdOf(user as any);
    const since = Date.now() - CLOSED_DAYS * 86_400_000;
    const db = getFirestore();
    const [snap, sellers] = await Promise.all([
      db.collection(dealsCol(user.uid)).orderBy("updatedAt", "desc").limit(1000).get(),
      listSellers(user.uid),
    ]);
    const deals = snap.docs
      .filter((d) => all || !d.get("assigneeId") || d.get("assigneeId") === me)
      .filter((d) => !["vendido", "perdido"].includes(d.get("stage")) || ((d.get("stageChangedAt") as Timestamp | undefined)?.toMillis() ?? 0) > since)
      .map((d) => toDealRow(d.id, d.data()));
    return res.json({ deals, sellers, me });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

dealsRouter.post("/", authRequired({ perm: "deals.edit" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const ref = await createDealFor(user.uid, user as any, req.body || {});
    return res.status(201).json({ deal: toDealRow(ref.id, (await ref.get()).data()!) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

dealsRouter.patch("/:id", authRequired({ perm: "deals.edit" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const id = req.params.id as string;
    const db = getFirestore();
    const ref = db.doc(dealDoc(user.uid, id));
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Oportunidad no encontrada" });
    const data = snap.data()!;
    assertDealAccess(user as any, data);
    const update = await parseDealInput(user.uid, user as any, req.body || {}, data);
    await ref.update({ ...update, updatedAt: FieldValue.serverTimestamp() });
    return res.json({ deal: toDealRow(id, (await ref.get()).data()!) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

dealsRouter.delete("/:id", authRequired({ perm: "deals.edit" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const id = req.params.id as string;
    const db = getFirestore();
    const ref = db.doc(dealDoc(user.uid, id));
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Oportunidad no encontrada" });
    const data = snap.data()!;
    assertDealAccess(user as any, data);
    if (data.stage === "apartado" || data.stage === "vendido") {
      return res.status(409).json({ error: "No se puede borrar una oportunidad apartada o vendida" });
    }
    await ref.delete();
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

dealsRouter.post("/:id/reserve", authRequired({ perm: "deals.reserve" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const id = req.params.id as string;
    await reserveDeal(user.uid, user as any, id, req.body || {});
    const db = getFirestore();
    return res.json({ deal: toDealRow(id, (await db.doc(dealDoc(user.uid, id)).get()).data()!) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

dealsRouter.post("/:id/release", authRequired({ perm: "deals.void" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const id = req.params.id as string;
    await releaseDeal(user.uid, user as any, id);
    const db = getFirestore();
    return res.json({ deal: toDealRow(id, (await db.doc(dealDoc(user.uid, id)).get()).data()!) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

dealsRouter.post("/:id/close", authRequired({ perm: "deals.sell" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const id = req.params.id as string;
    const saleId = await closeDeal(user.uid, user as any, id, req.body || {});
    const db = getFirestore();
    return res.json({ saleId, deal: toDealRow(id, (await db.doc(dealDoc(user.uid, id)).get()).data()!) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

