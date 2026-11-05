import { Router, Response } from "express";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { authRequired, AuthenticatedRequest } from "../api_middleware";
import { agendasCol, agendaDoc, bookingsCol } from "../paths";
import { parseAgendaInput } from "../lib/agendas";
import { listSellers } from "../lib/deals-server";

export const agendasRouter = Router();

agendasRouter.get("/agents", authRequired({ perm: "agenda" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    return res.json({ agents: await listSellers(user.uid) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

agendasRouter.post("/", authRequired({ perm: "settings.agendas" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const data = parseAgendaInput(req.body);
    const db = getFirestore();
    const ref = await db.collection(agendasCol(user.uid)).add({
      ...data,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return res.json({ id: ref.id });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

agendasRouter.put("/:id", authRequired({ perm: "settings.agendas" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const id = req.params.id as string;
    const db = getFirestore();
    const ref = db.doc(agendaDoc(user.uid, id));
    if (!(await ref.get()).exists) return res.status(404).json({ error: "Agenda no encontrada" });
    await ref.set({ ...parseAgendaInput(req.body), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return res.json({ id });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

agendasRouter.delete("/:id", authRequired({ perm: "settings.agendas" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const id = req.params.id as string;
    const db = getFirestore();
    const ref = db.doc(agendaDoc(user.uid, id));
    const upcoming = await db.collection(bookingsCol(user.uid)).where("agendaId", "==", id).get();
    if (upcoming.docs.some((b) => ["held", "confirmed"].includes(b.get("status")) && b.get("start").toMillis() > Date.now())) {
      return res.status(409).json({ error: "La agenda tiene citas próximas: cancélalas o desactívala" });
    }
    await db.recursiveDelete(ref);
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

