import { Router, Response } from "express";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { authRequired, AuthenticatedRequest } from "../api_middleware";
import { globalAiDoc } from "../paths";
import { encrypt } from "../lib/ai-crypto";
import { readGlobalAi, OPENROUTER_URL, getGlobalOpenRouterKey } from "../lib/openrouter";
import { listTenants, setTenantStatus, setTenantZernioKey } from "../lib/admin-tenants";
import { TenantStatus } from "../lib/tenants";

export const adminRouter = Router();

const STATUSES: TenantStatus[] = ["pending", "active", "disabled"];

// Admin AI
adminRouter.get("/ai", authRequired({ superAdmin: true }), async (_req, res: Response) => {
  try {
    return res.json(await readGlobalAi());
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

adminRouter.put("/ai", authRequired({ superAdmin: true }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const body = req.body as { openrouterKey?: string; clearKey?: boolean; textModel?: string | null };
    const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp(), updatedBy: user.email ?? user.uid };

    const key = body.openrouterKey?.trim();
    if (key) {
      if (!/^sk-or-[\w-]{10,}$/.test(key)) return res.status(400).json({ error: "La key de OpenRouter debe empezar por sk-or-" });
      update.openrouterKey = encrypt(key);
      update.keyHint = `…${key.slice(-4)}`;
    } else if (body.clearKey) {
      update.openrouterKey = FieldValue.delete();
      update.keyHint = FieldValue.delete();
    }
    if (body.textModel !== undefined) {
      if (body.textModel !== null && !/^openai\/[\w.\-:]+$/.test(body.textModel)) return res.status(400).json({ error: "Modelo no válido" });
      update.textModel = body.textModel;
    }

    const db = getFirestore();
    await db.doc(globalAiDoc()).set(update, { merge: true });
    return res.json(await readGlobalAi());
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

adminRouter.post("/ai/test", authRequired({ superAdmin: true }), async (_req, res: Response) => {
  try {
    const key = await getGlobalOpenRouterKey();
    if (!key) return res.status(400).json({ error: "No hay ninguna API key de OpenRouter guardada" });

    const response = await fetch(`${OPENROUTER_URL}/key`, { headers: { Authorization: `Bearer ${key}` } });
    const body = (await response.json().catch(() => ({}))) as {
      data?: { label?: string; usage?: number; limit_remaining?: number | null };
      error?: { message?: string };
    };
    if (!response.ok) return res.status(400).json({ error: body.error?.message || "OpenRouter rechazó la key" });
    return res.json({
      ok: true,
      label: body.data?.label ?? null,
      usage: body.data?.usage ?? null,
      remaining: body.data?.limit_remaining ?? null,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

// Admin Tenants
adminRouter.get("/tenants", authRequired({ superAdmin: true }), async (_req, res: Response) => {
  try {
    return res.json({ tenants: await listTenants() });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

adminRouter.put("/tenants/:uid", authRequired({ superAdmin: true }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const uid = req.params.uid as string;
    const body = req.body as { zernioKey?: string; status?: TenantStatus };
    if (body.status && !STATUSES.includes(body.status)) return res.status(400).json({ error: "Estado no válido" });
    if (uid === user.uid && body.status && body.status !== "active") {
      return res.status(400).json({ error: "No puedes desactivar tu propia cuenta" });
    }

    const actor = user.email ?? user.uid;
    if (body.zernioKey?.trim()) await setTenantZernioKey(uid, body.zernioKey.trim(), actor);
    if (body.status) await setTenantStatus(uid, body.status, actor);

    const row = (await listTenants()).find((t) => t.uid === uid);
    if (!row) return res.status(404).json({ error: "Usuario no encontrado" });
    return res.json(row);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

