import { Router, Response } from "express";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { authRequired, AuthenticatedRequest } from "../api_middleware";
import { can } from "../lib/permissions";
import { propertiesCol, propertyDoc, dealsCol, dealDoc, salesCol, tasksCol } from "../paths";
import { parsePropertyInput, toPropertyRow, holdOf } from "../lib/properties";
import { MAX_PHOTOS, thumbPathOf, TITLE_MAX } from "../lib/property-catalog";
import { PropertyPhoto } from "../lib/types";
import { requireAi } from "../lib/knowledge-store";
import { llmText } from "../lib/openrouter";
import { propertyFacts } from "../lib/property-facts";
import { closeDeal, createDealFor, toDealRow, listSellers, sellerIdOf, relistProperty } from "../lib/deals-server";
import { DEMO_COUNT, DEMO_PHOTO_SIZE, demoPhotos, demoProperty } from "../lib/demo-inventory";
import { renderThumb, thumbForStoredPhoto } from "../lib/property-thumbs";
import { randomUUID } from "crypto";

export const propertiesRouter = Router();

const STORAGE_HOST = "firebasestorage.googleapis.com";
const HOLD_HOURS = [2, 4, 24, 48, 72] as const;
const clip = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

propertiesRouter.get("/", authRequired({ perm: "inventory" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const showPrivate = can(user.actor.perms, "inventory.private");
    const db = getFirestore();
    const snap = await db.collection(propertiesCol(user.uid)).orderBy("updatedAt", "desc").limit(1000).get();
    return res.json({ properties: snap.docs.map((d) => toPropertyRow(d.id, d.data(), showPrivate)) });
  } catch (err: any) {
    console.error("GET /properties error:", err);
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

propertiesRouter.post("/", authRequired({ perm: "inventory.edit" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const canPrivate = can(user.actor.perms, "inventory.private");
    const data = parsePropertyInput(req.body, canPrivate);
    const db = getFirestore();
    const ref = db.collection(propertiesCol(user.uid)).doc();
    await ref.set({
      ...data,
      photos: [],
      reservation: null,
      lease: null,
      closedAt: null,
      createdBy: user.actor.authUid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return res.json({ property: toPropertyRow(ref.id, (await ref.get()).data()!, canPrivate) });
  } catch (err: any) {
    console.error("POST /properties error:", err);
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

propertiesRouter.post("/copy", authRequired({ perm: "inventory.edit" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const v = parsePropertyInput(req.body, false);
    const { ai, apiKey, model } = await requireAi(user.uid);
    const facts = [
      ai.brand.name ? `Inmobiliaria: ${ai.brand.name}` : "",
      ai.brand.tone ? `Tono de la marca: ${ai.brand.tone}` : "",
      ...propertyFacts(v),
    ].filter(Boolean);

    const SYSTEM = `Eres un copywriter inmobiliario profesional en México. Escribes el título y la descripción de un anuncio
de UN inmueble para portales inmobiliarios, la ficha de la propiedad y las cotizaciones que reciben los clientes.
Reglas:
- Usa SOLO los datos que te doy.
- Título: Máximo ${TITLE_MAX} caracteres.
- Descripción: 120 a 220 palabras en 3-4 párrafos cortos.
Responde SOLO con JSON válido: {"title": "...", "description": "..."}`;

    const text = await llmText(apiKey, model, SYSTEM, facts.join("\n"), 1200, 0.7);
    const raw = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
    const o = JSON.parse(json);
    return res.json({ title: String(o.title || "").slice(0, TITLE_MAX), description: String(o.description || "").slice(0, 5000) });
  } catch (err: any) {
    console.error("POST /properties/copy error:", err);
    return res.status(502).json({ error: "No se pudo generar el texto, intenta de nuevo" });
  }
});

propertiesRouter.post("/demo", authRequired({ perm: "inventory.edit" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const db = getFirestore();
    const col = db.collection(propertiesCol(user.uid));
    if (!(await col.where("demo", "==", true).limit(1).get()).empty) {
      return res.status(409).json({ error: "Los datos de prueba ya están cargados. Bórralos antes de volver a cargarlos." });
    }
    const batch = db.batch();
    for (let i = 0; i < DEMO_COUNT; i++) {
      const ref = col.doc();
      batch.set(ref, {
        ...parsePropertyInput(demoProperty(i), true),
        demo: true,
        photos: [],
        reservation: null,
        lease: null,
        closedAt: null,
        createdBy: user.actor.authUid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
    return res.json({ created: DEMO_COUNT, photos: false });
  } catch (err: any) {
    console.error("POST /properties/demo error:", err);
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

propertiesRouter.delete("/demo", authRequired({ perm: "inventory.delete" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const db = getFirestore();
    const demo = await db.collection(propertiesCol(user.uid)).where("demo", "==", true).get();
    const ids = new Set(demo.docs.map((d) => d.id));
    if (!ids.size) return res.json({ properties: 0, deals: 0, sales: 0, tasks: 0 });

    const [deals, sales, tasks] = await Promise.all([
      db.collection(dealsCol(user.uid)).get(),
      db.collection(salesCol(user.uid)).get(),
      db.collection(tasksCol(user.uid)).get(),
    ]);
    const demoDeals = deals.docs.filter((d) => ids.has(d.get("propertyId")));
    const dealIds = new Set(demoDeals.map((d) => d.id));
    const demoSales = sales.docs.filter((d) => ids.has(d.get("propertyId")));
    const demoTasks = tasks.docs.filter((d) => ids.has(d.get("propertyId")) || dealIds.has(d.get("dealId")));

    const allRefs = [...demoTasks, ...demoSales, ...demoDeals, ...demo.docs].map((d) => d.ref);
    for (let i = 0; i < allRefs.length; i += 400) {
      const batch = db.batch();
      allRefs.slice(i, i + 400).forEach((r) => batch.delete(r));
      await batch.commit();
    }
    return res.json({ properties: ids.size, deals: demoDeals.length, sales: demoSales.length, tasks: demoTasks.length });
  } catch (err: any) {
    console.error("DELETE /properties/demo error:", err);
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

propertiesRouter.post("/thumbs", authRequired({ perm: "inventory" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const db = getFirestore();
    const snap = await db.collection(propertiesCol(user.uid)).get();
    const missing = snap.docs
      .flatMap((d) => ((d.get("photos") ?? []) as PropertyPhoto[]).map((p, i) => ({ ref: d.ref, path: p.path, cover: i === 0, has: !!p.thumb })))
      .filter((x) => !x.has && x.path)
      .sort((a, b) => Number(b.cover) - Number(a.cover));
    const batch = missing.slice(0, 8);
    let failed = 0;
    for (const item of batch) {
      try {
        const t = await thumbForStoredPhoto(item.path);
        await db.runTransaction(async (tx) => {
          const s = await tx.get(item.ref);
          const photos = ((s.get("photos") ?? []) as PropertyPhoto[]).map((p) => (p.path === item.path ? { ...p, ...t } : p));
          tx.update(item.ref, { photos });
        });
      } catch {
        failed++;
      }
    }
    return res.json({ done: batch.length - failed, failed, remaining: missing.length - (batch.length - failed) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

propertiesRouter.get("/:id", authRequired({ perm: "inventory" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const id = req.params.id as string;
    const db = getFirestore();
    const snap = await db.doc(propertyDoc(user.uid, id)).get();
    if (!snap.exists) return res.status(404).json({ error: "Inmueble no encontrado" });
    return res.json({ property: toPropertyRow(id, snap.data()!, can(user.actor.perms, "inventory.private")) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

propertiesRouter.put("/:id", authRequired({ perm: "inventory.edit" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const id = req.params.id as string;
    const canPrivate = can(user.actor.perms, "inventory.private");
    const db = getFirestore();
    const ref = db.doc(propertyDoc(user.uid, id));
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Inmueble no encontrado" });
    const { status, ...data } = parsePropertyInput(req.body, canPrivate);
    const locked = ["apartado", "vendido", "rentado"].includes(snap.get("status"));
    await ref.update({ ...data, ...(locked ? {} : { status }), updatedAt: FieldValue.serverTimestamp() });
    return res.json({ property: toPropertyRow(id, (await ref.get()).data()!, canPrivate) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

propertiesRouter.delete("/:id", authRequired({ perm: "inventory.delete" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const id = req.params.id as string;
    const db = getFirestore();
    const ref = db.doc(propertyDoc(user.uid, id));
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Inmueble no encontrado" });
    if (["vendido", "rentado"].includes(snap.get("status"))) {
      return res.status(409).json({ error: "Un inmueble vendido o rentado no se puede borrar: queda en el historial" });
    }
    if (snap.get("status") === "apartado") {
      return res.status(409).json({ error: "Libera el apartado antes de borrar el inmueble" });
    }
    await getStorage().bucket().deleteFiles({ prefix: `${propertyDoc(user.uid, id)}/` }).catch(() => {});
    await ref.delete();
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

propertiesRouter.post("/:id/caption", authRequired({ perm: "posts.create" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const id = req.params.id as string;
    const db = getFirestore();
    const snap = await db.doc(propertyDoc(user.uid, id)).get();
    if (!snap.exists) return res.status(404).json({ error: "Inmueble no encontrado" });
    const v = toPropertyRow(id, snap.data()!, false);
    const { tone } = req.body || {};
    const { ai, apiKey, model } = await requireAi(user.uid);
    const facts = [
      `Negocio: ${ai.brand.name || "—"}`,
      ai.brand.tone ? `Tono de la marca: ${ai.brand.tone}` : "",
      tone ? `Indicación para este post: ${String(tone).slice(0, 300)}` : "",
      ...propertyFacts(v, { includeTitle: true }),
    ].filter(Boolean);
    const SYSTEM = `Eres el community manager de una inmobiliaria en México. Escribes el texto de una publicación para Facebook e Instagram que anuncia UN inmueble en venta o renta. Máximo 900 caracteres.`;
    const caption = await llmText(apiKey, model, SYSTEM, facts.join("\n"), 700, 0.7);
    return res.json({ caption: caption.slice(0, 2200) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

propertiesRouter.post("/:id/close", authRequired({ perm: "deals.sell" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const id = req.params.id as string;
    const body = req.body || {};
    const db = getFirestore();
    const propertyRef = db.doc(propertyDoc(user.uid, id));
    const property = await propertyRef.get();
    if (!property.exists) return res.status(404).json({ error: "Inmueble no encontrado" });
    const status = property.get("status");
    if (status === "vendido" || status === "rentado") return res.status(409).json({ error: `El inmueble ya está ${status}` });
    if (status === "borrador") return res.status(409).json({ error: "Publica el inmueble antes de cerrarlo" });

    const clientId = clip(body.clientId, 400) || null;
    let dealId: string | null = null;
    if (status === "apartado") {
      dealId = (property.get("reservation.dealId") as string | undefined) ?? null;
    } else {
      const open = (await db.collection(dealsCol(user.uid)).where("propertyId", "==", id).get()).docs.filter(
        (d) => !["vendido", "perdido"].includes(d.get("stage")),
      );
      dealId = (clientId && open.find((d) => d.get("clientId") === clientId)?.id) || null;
    }
    if (!dealId) {
      const clientName = clip(body.clientName, 120);
      if (!clientId && !clientName) return res.status(400).json({ error: "Indica el cliente" });
      const ref = await createDealFor(user.uid, user as any, {
        stage: "negociacion",
        propertyId: id,
        value: Number(body.finalPrice) || Number(body.monthlyRent) || null,
        ...(clientId ? { clientId } : { clientName, clientPhone: clip(body.clientWhatsapp, 30) }),
      });
      await ref.update({ source: "Propiedades" });
      dealId = ref.id;
    }
    await closeDeal(user.uid, user as any, dealId, body);
    const [v, deal] = await Promise.all([propertyRef.get(), db.doc(dealDoc(user.uid, dealId)).get()]);
    return res.json({ property: toPropertyRow(id, v.data()!, can(user.actor.perms, "inventory.private")), deal: toDealRow(deal.id, deal.data()!) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

propertiesRouter.post("/:id/hold", authRequired({ perm: "inventory" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const id = req.params.id as string;
    const body = req.body || {};
    const hours = Number(body.hours);
    if (!HOLD_HOURS.includes(hours as any)) return res.status(400).json({ error: "Duración no válida" });
    const byId = sellerIdOf(user as any) ?? "";
    const byName = (await listSellers(user.uid)).find((s) => s.id === byId)?.name ?? user.actor.email ?? "";
    const db = getFirestore();
    const ref = db.doc(propertyDoc(user.uid, id));
    const previous = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error("Inmueble no encontrado");
      if (!["disponible", "apartado"].includes(snap.get("status"))) throw new Error("Solo se pueden bloquear inmuebles disponibles o apartados");
      const current = holdOf(snap.get("hold"));
      tx.update(ref, {
        hold: {
          byId,
          byName,
          until: Timestamp.fromMillis(Date.now() + hours * 3_600_000),
          note: typeof body.note === "string" ? body.note.trim().slice(0, 200) : "",
          at: FieldValue.serverTimestamp(),
        },
      });
      return current && current.byId !== byId ? current : null;
    });
    return res.json({ property: toPropertyRow(id, (await ref.get()).data()!, can(user.actor.perms, "inventory.private")), previous });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

propertiesRouter.delete("/:id/hold", authRequired({ perm: "inventory" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const id = req.params.id as string;
    const db = getFirestore();
    const ref = db.doc(propertyDoc(user.uid, id));
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Inmueble no encontrado" });
    const current = holdOf(snap.get("hold"));
    if (current && current.byId !== sellerIdOf(user as any) && !can(user.actor.perms, "inventory.edit")) {
      return res.status(403).json({ error: `Solo ${current.byName || "quien lo bloqueó"} o un supervisor puede liberarlo` });
    }
    await ref.update({ hold: FieldValue.delete() });
    return res.json({ property: toPropertyRow(id, (await ref.get()).data()!, can(user.actor.perms, "inventory.private")) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

propertiesRouter.post("/:id/relist", authRequired({ perm: "inventory.edit" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const id = req.params.id as string;
    await relistProperty(user.uid, id);
    const db = getFirestore();
    const snap = await db.doc(propertyDoc(user.uid, id)).get();
    return res.json({ property: toPropertyRow(id, snap.data()!, can(user.actor.perms, "inventory.private")) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

propertiesRouter.post("/:id/photos", authRequired({ perm: "inventory.edit" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const id = req.params.id as string;
    const body = (req.body || {}) as Partial<PropertyPhoto>;
    const prefix = `${propertyDoc(user.uid, id)}/`;
    if (typeof body.path !== "string" || !body.path.startsWith(prefix) || body.path.includes("..")) {
      return res.status(400).json({ error: "Ruta de foto no válida" });
    }
    const photo: PropertyPhoto = {
      path: body.path,
      url: String(body.url),
      size: Math.max(0, Number(body.size) || 0),
      ...(Number(body.w) > 0 ? { w: Math.round(Number(body.w)) } : {}),
      ...(Number(body.h) > 0 ? { h: Math.round(Number(body.h)) } : {}),
      ...(body.thumb ? { thumb: String(body.thumb), thumbPath: body.thumbPath } : {}),
    };
    const db = getFirestore();
    const ref = db.doc(propertyDoc(user.uid, id));
    const photos = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error("Inmueble no encontrado");
      const list = (snap.get("photos") ?? []) as PropertyPhoto[];
      if (list.some((p) => p.path === photo.path)) return list;
      if (list.length >= MAX_PHOTOS) throw new Error(`Máximo ${MAX_PHOTOS} fotos por propiedad`);
      const next = [...list, photo];
      tx.update(ref, { photos: next, updatedAt: FieldValue.serverTimestamp() });
      return next;
    });
    return res.json({ photos });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

propertiesRouter.put("/:id/photos", authRequired({ perm: "inventory.edit" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const id = req.params.id as string;
    const { order } = req.body || {};
    if (!Array.isArray(order)) return res.status(400).json({ error: "Orden no válido" });
    const db = getFirestore();
    const ref = db.doc(propertyDoc(user.uid, id));
    const photos = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error("Inmueble no encontrado");
      const list = (snap.get("photos") ?? []) as PropertyPhoto[];
      const byPath = new Map(list.map((p) => [p.path, p]));
      const next = [...order.map((p) => byPath.get(String(p))).filter((p): p is PropertyPhoto => !!p), ...list.filter((p) => !order.includes(p.path))];
      tx.update(ref, { photos: next, updatedAt: FieldValue.serverTimestamp() });
      return next;
    });
    return res.json({ photos });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

propertiesRouter.delete("/:id/photos", authRequired({ perm: "inventory.edit" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const id = req.params.id as string;
    const path = String(req.query.path || "");
    if (!path.startsWith(`${propertyDoc(user.uid, id)}/`) || path.includes("..")) {
      return res.status(400).json({ error: "Ruta de foto no válida" });
    }
    const db = getFirestore();
    const ref = db.doc(propertyDoc(user.uid, id));
    const photos = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error("Inmueble no encontrado");
      const next = ((snap.get("photos") ?? []) as PropertyPhoto[]).filter((p) => p.path !== path);
      tx.update(ref, { photos: next, updatedAt: FieldValue.serverTimestamp() });
      return next;
    });
    for (const p of [path, thumbPathOf(path)]) {
      await getStorage().bucket().file(p).delete({ ignoreNotFound: true }).catch(() => {});
    }
    return res.json({ photos });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

