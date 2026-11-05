import { Router, Response } from "express";
import { FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { authRequired, AuthenticatedRequest } from "../api_middleware";
import { tenantDoc, userDoc } from "../paths";
import { ensureTenant, isSuperAdmin, tenantStatus } from "../lib/tenants";
import { ensureVisitAgenda } from "../lib/agendas";

export const meRouter = Router();

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

meRouter.get("/", authRequired({ allowInactive: true }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const a = user.actor;
    if (!a.isOwner) {
      const workspaceStatus = await tenantStatus(a.uid);
      return res.json({
        uid: a.authUid,
        workspaceUid: a.uid,
        email: a.email,
        role: "member",
        sellerId: a.memberId,
        teamRole: a.role,
        perms: a.perms,
        status: a.status === "active" ? workspaceStatus : "disabled",
      });
    }
    await ensureTenant(user);
    const [superadmin, status] = await Promise.all([
      isSuperAdmin(user),
      tenantStatus(a.uid),
      ensureVisitAgenda(a.uid).catch((e) => console.warn("visit agenda", e)),
    ]);
    return res.json({
      uid: a.authUid,
      workspaceUid: a.uid,
      email: a.email,
      role: superadmin ? "superadmin" : "admin",
      sellerId: "owner",
      teamRole: null,
      perms: null,
      status,
    });
  } catch (err: any) {
    console.error("GET /me error:", err);
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

meRouter.put("/", authRequired({ allowInactive: true }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const a = user.actor;
    if (!a.isOwner) return res.status(403).json({ error: "Solo para cuentas de empresa" });

    const b = req.body as Record<string, unknown>;
    const firstName = clip(b.firstName, 80);
    const lastName = clip(b.lastName, 120);
    const companyName = clip(b.company, 120);
    const wa = clip(b.whatsapp, 30).replace(/[\s().-]/g, "");
    if (!firstName) return res.status(400).json({ error: "Indica tu nombre" });
    if (!companyName) return res.status(400).json({ error: "Indica el nombre de la empresa" });
    if (!/^\+?\d{6,15}$/.test(wa)) return res.status(400).json({ error: "WhatsApp no válido: usa el número con prefijo de país" });
    const whatsapp = wa.startsWith("+") ? wa : `+${wa}`;

    await ensureTenant(user);
    const db = getFirestore();
    const ref = db.doc(userDoc(a.uid));
    const current = (await ref.get()).data() ?? {};
    const displayName = [firstName, lastName].filter(Boolean).join(" ");
    await ref.set(
      {
        displayName,
        profile: { ...(current.profile ?? {}), firstName, lastName, phone: whatsapp },
        company: { ...(current.company ?? {}), name: current.company?.name || companyName, whatsapp: current.company?.whatsapp || whatsapp },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    await db.doc(tenantDoc(a.uid)).set({ companyName, contactName: displayName, whatsapp }, { merge: true });
    await getAuth().updateUser(a.authUid, { displayName });
    return res.json({ ok: true });
  } catch (err: any) {
    console.error("PUT /me error:", err);
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

