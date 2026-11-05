import { Router, Request, Response } from "express";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { authRequired, AuthenticatedRequest } from "../api_middleware";
import { quotesCol, conversationMessagesCol, clientDoc, dealDoc, dealsCol, taskDoc } from "../paths";
import { authorKeyOf, clientIdOf } from "../lib/clients";
import { createQuote, getQuote, parseQuoteInput, quoteFileName, toQuoteRow, quoteStatus, QuoteDoc, quotePath } from "../lib/quotes-server";
import { listSellers, sellerIdOf } from "../lib/deals-server";
import { quoteByToken, toPublicQuote, isPreviewBot } from "../lib/quote-public";
import { forSale, GUARDED_STAGES } from "../lib/property-catalog";
import { TERM_OPTIONS } from "../lib/quote-math";
import { renderCatalogPdf } from "../lib/catalog-pdf-render";

export const quotesRouter = Router();

// Private quote management (auth required)
quotesRouter.get("/", authRequired({ perm: "inventory" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const clientId = req.query.clientId as string | undefined;
    const conversationId = req.query.conversationId as string | undefined;
    const status = req.query.status as string | undefined;

    const db = getFirestore();
    const col = db.collection(quotesCol(user.uid));
    const snap = clientId
      ? await col.where("clientId", "==", clientId).limit(100).get()
      : conversationId
      ? await col.where("conversationId", "==", conversationId).limit(100).get()
      : await col.orderBy("createdAt", "desc").limit(200).get();

    const quotes = snap.docs
      .map((d) => toQuoteRow(d.id, d.data() as QuoteDoc))
      .filter((r) => !status || r.status === status)
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    return res.json({ quotes });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

quotesRouter.post("/", authRequired({ perm: "inventory" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const input = parseQuoteInput(req.body);
    const db = getFirestore();

    if (input.conversationId && !input.clientId) {
      const last = await db.collection(conversationMessagesCol(user.uid, input.conversationId)).orderBy("createdAt", "desc").limit(20).get();
      const inbound = last.docs.find((d) => d.get("direction") === "in");
      const key = authorKeyOf(inbound?.get("author"));
      if (inbound?.get("platform") && key) {
        const cId = clientIdOf(inbound.get("platform"), key);
        if ((await db.doc(clientDoc(user.uid, cId)).get()).exists) input.clientId = cId;
      }
    }
    const sellerId = sellerIdOf(user as any);
    const seller = (await listSellers(user.uid)).find((s) => s.id === sellerId);
    const { id } = await createQuote(user.uid, input, { id: sellerId, name: seller?.name ?? "" });
    const quote = await getQuote(user.uid, id);
    return res.status(201).json({ ...toQuoteRow(id, quote), fileName: quoteFileName(quote) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

quotesRouter.get("/:id/pdf", authRequired({ perm: "inventory" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const id = req.params.id as string;
    const quote = await getQuote(user.uid, id);
    const origin = `${req.protocol}://${req.get("host")}`;
    const link = quote.token ? `${origin}${quotePath(quote.token)}` : null;
    const pdf = await renderCatalogPdf(user.uid, quote, link);
    const name = quoteFileName(quote);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.setHeader("Cache-Control", "private, no-store");
    return res.send(Buffer.from(pdf));
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error al generar PDF" });
  }
});

// Public quote routes (no login required)
export const publicQuotesRouter = Router();

publicQuotesRouter.get("/:token/view", async (req: Request, res: Response) => {
  try {
    const token = req.params.token as string;
    const { uid, quote } = await quoteByToken(token);
    const pub = await toPublicQuote(uid, quote);
    return res.json({ quote: pub });
  } catch (err: any) {
    return res.status(404).json({ error: "Cotización no encontrada o expirada" });
  }
});

publicQuotesRouter.post("/:token/view", async (req: Request, res: Response) => {
  try {
    if (isPreviewBot((req.headers["user-agent"] as string) || null)) return res.json({ counted: false });
    const token = req.params.token as string;
    const { uid, quoteId, ref } = await quoteByToken(token);
    const db = getFirestore();
    const first = await db.runTransaction(async (tx) => {
      const q = await tx.get(ref);
      const last = (q.get("lastViewedAt") as Timestamp | null)?.toMillis() ?? 0;
      if (Date.now() - last < 60_000) return null;
      const isFirst = !q.get("firstViewedAt");
      tx.update(ref, {
        views: FieldValue.increment(1),
        lastViewedAt: FieldValue.serverTimestamp(),
        ...(isFirst ? { firstViewedAt: FieldValue.serverTimestamp(), ...(q.get("status") === "accepted" ? {} : { status: "viewed" }) } : {}),
      });
      return isFirst ? q.data()! : null;
    });
    if (first) {
      await db
        .doc(taskDoc(uid, `quote_viewed_${quoteId}`))
        .create({
          title: `${first.clientName || "Un cliente"} abrió tu cotización ${first.folio}`,
          dueAt: Timestamp.now(),
          assigneeId: first.sellerId ?? null,
          clientId: first.clientId ?? null,
          dealId: first.dealId ?? null,
          propertyId: first.properties?.[0]?.id ?? null,
          conversationId: first.conversationId ?? null,
          kind: "quote_viewed",
          done: false,
          doneAt: null,
          notes: "",
          createdAt: FieldValue.serverTimestamp(),
        })
        .catch(() => {});
    }
    return res.json({ counted: true });
  } catch (err: any) {
    return res.status(500).json({ error: "Error" });
  }
});

publicQuotesRouter.post("/:token/accept", async (req: Request, res: Response) => {
  try {
    const token = req.params.token as string;
    const body = req.body || {};
    const { uid, quoteId, ref, quote } = await quoteByToken(token);
    if (quoteStatus(quote) === "expired") return res.status(409).json({ error: "La cotización ya venció; escríbenos por WhatsApp" });
    const property = quote.properties.find((v) => v.id === body.propertyId);
    if (!property) return res.status(400).json({ error: "Ese inmueble no está en la cotización" });

    const sale = forSale(property.operation ?? "venta");
    const terms: number[] = quote.financing?.terms ?? [...TERM_OPTIONS];
    const months = !sale || body.months == null ? null : Number(body.months);
    if (months !== null && !terms.includes(months)) return res.status(400).json({ error: "Plazo no válido" });
    const downPct = !sale ? null : body.downPct == null ? quote.minDownPct : Math.round(Number(body.downPct));
    if (downPct !== null && (!Number.isFinite(downPct) || downPct < quote.minDownPct || downPct > 90)) {
      return res.status(400).json({ error: `El enganche debe ser de ${quote.minDownPct}% a 90%` });
    }
    const plan = months ? ` con ${downPct}% de enganche a ${months / 12} años` : "";

    const db = getFirestore();
    const result = await db.runTransaction(async (tx) => {
      const fresh = (await tx.get(ref)).data() as QuoteDoc;
      if (fresh.accepted) return { already: true, same: fresh.accepted.propertyId === property.id };
      const dealRef = fresh.dealId ? db.doc(dealDoc(uid, fresh.dealId)) : null;
      const deal = dealRef ? await tx.get(dealRef) : null;
      tx.update(ref, { status: "accepted", accepted: { propertyId: property.id, propertyTitle: property.title, downPct, months, at: FieldValue.serverTimestamp() } });
      let dealId = fresh.dealId;
      if (deal?.exists) {
        if (!GUARDED_STAGES.includes(deal.get("stage"))) {
          tx.update(deal.ref, { stage: "negociacion", propertyId: property.id, propertyTitle: property.title, value: property.price, stageChangedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
        }
      } else {
        const newDeal = db.collection(dealsCol(uid)).doc();
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
      tx.set(db.doc(taskDoc(uid, `quote_accepted_${quoteId}`)), {
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
    if (result.already && !result.same) {
      return res.status(409).json({ error: "Ya nos indicaste otra propiedad de esta cotización" });
    }
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: "Error" });
  }
});

