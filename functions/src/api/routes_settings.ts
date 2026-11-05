import { Router, Response } from "express";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { authRequired, AuthenticatedRequest } from "../api_middleware";
import { can } from "../lib/permissions";
import { userDoc, memberDoc, memberIndexDoc, aiKnowledgeDoc, aiKnowledgeFilesCol } from "../paths";
import { roleLabel } from "../lib/permissions";
import { COMPANY_FILE_ID, companyMarkdown, parseCompany } from "../lib/company";
import { recompile } from "../lib/knowledge-store";
import { AI_MODES, readAiSettings, AiMode, AiSettings } from "../lib/openrouter";
import { parseAvailability } from "../lib/agendas";
import { normaliseImageSettings } from "../lib/watermark";
import { readPostImages, isAllowedMediaUrl } from "../lib/watermark-server";
import { parseQuoteDefaults, readQuoteDefaults } from "../lib/quotes-server";

export const settingsRouter = Router();

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const keywords = (v: unknown) =>
  [...new Set((Array.isArray(v) ? v : []).filter((k): k is string => typeof k === "string").map((k) => k.trim().slice(0, 40)).filter(Boolean))].slice(0, 20);

// Profile
settingsRouter.get("/profile", authRequired(), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const a = user.actor;
    const authUser = await getAuth().getUser(a.authUid);
    const db = getFirestore();
    if (a.isOwner) {
      const p = ((await db.doc(userDoc(a.uid)).get()).get("profile") ?? {}) as Record<string, string>;
      return res.json({
        profile: { firstName: p.firstName ?? "", lastName: p.lastName ?? "", phone: p.phone ?? "", jobTitle: p.jobTitle ?? "", photoURL: p.photoURL ?? authUser.photoURL ?? "" },
        email: a.email,
        role: "Dueño de la cuenta",
        nameEditable: true,
      });
    }
    const m = (await db.doc(memberDoc(a.uid, a.memberId!)).get()).data() ?? {};
    return res.json({
      profile: { firstName: m.firstName ?? "", lastName: m.lastName ?? "", phone: m.whatsapp ?? "", jobTitle: m.jobTitle ?? "", photoURL: m.photoURL ?? authUser.photoURL ?? "" },
      email: a.email,
      role: roleLabel(a.role),
      nameEditable: false,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

settingsRouter.put("/profile", authRequired(), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const a = user.actor;
    const b = req.body || {};
    const photoURL = clip(b.photoURL, 1000);
    if (photoURL && !/^https:\/\//.test(photoURL)) return res.status(400).json({ error: "Foto no válida" });
    const phone = clip(b.phone, 30);
    if (phone && !/^\+?[\d\s().-]{6,20}$/.test(phone)) return res.status(400).json({ error: "Teléfono no válido" });
    const jobTitle = clip(b.jobTitle, 80);

    const db = getFirestore();
    if (a.isOwner) {
      const profile = { firstName: clip(b.firstName, 80), lastName: clip(b.lastName, 120), phone, jobTitle, photoURL };
      if (!profile.firstName) return res.status(400).json({ error: "Indica tu nombre" });
      const displayName = [profile.firstName, profile.lastName].filter(Boolean).join(" ");
      await db.doc(userDoc(a.uid)).set({ profile, displayName, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      await getAuth().updateUser(a.authUid, { displayName, photoURL: photoURL || null });
      return res.json({ profile });
    }

    const ref = db.doc(memberDoc(a.uid, a.memberId!));
    const m = (await ref.get()).data() ?? {};
    const whatsapp = phone.replace(/[\s().-]/g, "");
    await ref.update({ whatsapp: whatsapp && !whatsapp.startsWith("+") ? `+${whatsapp}` : whatsapp, jobTitle, photoURL, updatedAt: FieldValue.serverTimestamp() });
    await db.doc(memberIndexDoc(a.authUid)).set({ photoURL }, { merge: true });
    await getAuth().updateUser(a.authUid, { photoURL: photoURL || null });
    return res.json({ profile: { firstName: m.firstName, lastName: m.lastName, phone: whatsapp, jobTitle, photoURL } });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

// Company
settingsRouter.get("/company", authRequired(), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const db = getFirestore();
    const snap = await db.doc(userDoc(user.uid)).get();
    return res.json({ company: snap.get("company") ?? null });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

settingsRouter.put("/company", authRequired({ perm: "settings.empresa" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const company = parseCompany(req.body);
    const markdown = companyMarkdown(company);
    const db = getFirestore();
    await db.doc(userDoc(user.uid)).set({ company: { ...company, updatedAt: FieldValue.serverTimestamp() } }, { merge: true });
    await db.collection(aiKnowledgeFilesCol(user.uid)).doc(COMPANY_FILE_ID).set({
      name: "Datos de la empresa.md",
      source: "company",
      pages: 0,
      chars: markdown.length,
      markdown,
      createdAt: FieldValue.serverTimestamp(),
    });
    let manual: "updated" | "stale" = "updated";
    try {
      await recompile(user.uid);
    } catch {
      manual = "stale";
      await db.doc(aiKnowledgeDoc(user.uid)).set({ stale: true }, { merge: true });
    }
    return res.json({ company, markdown, manual });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

// AI Settings
settingsRouter.get("/ai", authRequired(), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    return res.json(await readAiSettings(user.uid));
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

settingsRouter.put("/ai", authRequired(), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const body = (req.body || {}) as Partial<AiSettings>;
    const onlyMode = Object.keys(body).every((k) => k === "mode");
    if (!can(user.actor.perms, "settings.agente") && !(onlyMode && can(user.actor.perms, "inbox.agentMode"))) {
      return res.status(403).json({ error: "No tienes acceso a esta sección" });
    }
    if (body.mode && !AI_MODES.includes(body.mode as AiMode)) return res.status(400).json({ error: "Modo no válido" });

    const current = await readAiSettings(user.uid);
    const next: AiSettings = {
      ...current,
      mode: (body.mode as AiMode) ?? current.mode,
      instructions: body.instructions !== undefined ? clip(body.instructions, 4000) : current.instructions,
      brand: body.brand
        ? {
            name: clip(body.brand.name, 200),
            tone: clip(body.brand.tone, 2000),
            about: clip(body.brand.about, 2000),
            faq: clip(body.brand.faq, 2000),
            never: clip(body.brand.never, 2000),
          }
        : current.brand,
      quoteKeywords: body.quoteKeywords !== undefined ? keywords(body.quoteKeywords) : current.quoteKeywords,
      quoteKeywordsOnly: body.quoteKeywordsOnly !== undefined ? body.quoteKeywordsOnly === true : current.quoteKeywordsOnly,
    };
    if (next.quoteKeywordsOnly && !next.quoteKeywords.length) {
      return res.status(400).json({ error: "Agrega al menos una palabra clave o desactiva «Solo con palabra clave»" });
    }
    if (next.mode !== "off" && (!next.hasKey || !next.textModel)) {
      return res.status(400).json({ error: "El administrador aún no ha configurado la IA (API key y modelo)" });
    }

    const { mode, instructions, brand, quoteKeywords, quoteKeywordsOnly } = next;
    const db = getFirestore();
    await db.doc(userDoc(user.uid)).set({ ai: { mode, instructions, brand, quoteKeywords, quoteKeywordsOnly } }, { merge: true });
    if (JSON.stringify([current.instructions, current.brand]) !== JSON.stringify([next.instructions, next.brand])) {
      const k = db.doc(aiKnowledgeDoc(user.uid));
      if ((await k.get()).get("manual")) await k.update({ stale: true });
    }
    return res.json(next);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

// Availability
settingsRouter.get("/availability", authRequired(), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const db = getFirestore();
    const ref = db.doc(user.actor.isOwner ? userDoc(user.actor.uid) : memberDoc(user.actor.uid, user.actor.memberId!));
    const a = (await ref.get()).get("availability");
    return res.json({ availability: a ? parseAvailability(a) : { weekly: null, blockedDates: [] } });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

settingsRouter.put("/availability", authRequired(), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const availability = parseAvailability(req.body);
    const db = getFirestore();
    const ref = db.doc(user.actor.isOwner ? userDoc(user.actor.uid) : memberDoc(user.actor.uid, user.actor.memberId!));
    await ref.set({ availability, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return res.json({ availability });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

// Followup
settingsRouter.get("/followup", authRequired({ perm: "settings.agente" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const db = getFirestore();
    const hours = Number((await db.doc(userDoc(user.uid)).get()).get("followUp.staleHours")) || 4;
    return res.json({ staleHours: hours });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

settingsRouter.put("/followup", authRequired({ perm: "settings.agente" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const hours = Number(req.body?.staleHours);
    if (!Number.isFinite(hours) || hours < 1 || hours > 72) return res.status(400).json({ error: "Indica entre 1 y 72 horas" });
    const db = getFirestore();
    await db.doc(userDoc(user.uid)).set({ followUp: { staleHours: Math.round(hours) } }, { merge: true });
    return res.json({ staleHours: Math.round(hours) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

// Images
settingsRouter.get("/images", authRequired(), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    return res.json(await readPostImages(user.uid));
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

settingsRouter.put("/images", authRequired({ perm: "settings.imagenes" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const s = normaliseImageSettings(req.body || {});
    if (s.logoUrl && !isAllowedMediaUrl(s.logoUrl)) return res.status(400).json({ error: "Logo no válido: súbelo desde esta pantalla" });
    const db = getFirestore();
    await db.doc(userDoc(user.uid)).set({ postImages: { ...s, logoUrl: typeof req.body?.logoUrl === "string" ? s.logoUrl : "" } }, { merge: true });
    return res.json(await readPostImages(user.uid));
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

// Quotes Defaults
settingsRouter.get("/quotes", authRequired(), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    return res.json(await readQuoteDefaults(user.uid));
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

settingsRouter.put("/quotes", authRequired({ perm: "settings.empresa" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const defaults = parseQuoteDefaults(req.body);
    const db = getFirestore();
    await db.doc(userDoc(user.uid)).set({ quoteDefaults: defaults }, { merge: true });
    return res.json(defaults);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

