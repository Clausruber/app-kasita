import { Router, Request, Response } from "express";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { authRequired, AuthenticatedRequest } from "../api_middleware";
import { membersCol, memberDoc, memberIndexDoc, inviteDoc, userDoc, tenantDoc } from "../paths";
import {
  appOrigin,
  issueInvite,
  listMembers,
  parseInvite,
  toMemberRow,
  deleteMember,
  getMember,
  parseRole,
  parseWhatsapp,
  syncIndex,
  hashToken,
} from "../lib/team";
import { normalisePerms, roleLabel } from "../lib/permissions";
import { parseAvailability } from "../lib/agendas";

export const teamRouter = Router();

const notSelf = (memberId: string, actorMemberId: string | null) => {
  if (memberId === actorMemberId) throw new Error("No puedes cambiar tu propio acceso");
};

teamRouter.get("/", authRequired({ perm: "settings.usuarios" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    return res.json({ members: await listMembers(user.uid) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

teamRouter.post("/", authRequired({ perm: "settings.usuarios" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const data = parseInvite(req.body);
    if (data.email === user.actor.email?.toLowerCase()) {
      return res.status(400).json({ error: "No puedes invitarte a ti mismo" });
    }
    const db = getFirestore();
    const col = db.collection(membersCol(user.uid));
    if (!(await col.where("email", "==", data.email).limit(1).get()).empty) {
      return res.status(409).json({ error: "Ya hay un usuario con ese email en el equipo" });
    }
    const ref = await col.add({
      ...data,
      status: "invited",
      uid: null,
      invitedBy: user.actor.authUid,
      createdAt: FieldValue.serverTimestamp(),
    });
    const origin = `${req.protocol}://${req.get("host")}`;
    const invite = await issueInvite(user.uid, ref.id, data.email, origin);
    return res.status(201).json({ member: toMemberRow(ref.id, (await ref.get()).data()!), invite });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

teamRouter.put("/:id", authRequired({ perm: "settings.usuarios" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const id = req.params.id as string;
    notSelf(id, user.actor.memberId);
    const snap = await getMember(user.uid, id);
    const b = req.body || {};
    const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (b.role !== undefined) update.role = parseRole(b.role);
    if (b.perms !== undefined) update.perms = normalisePerms(b.perms);
    if (b.whatsapp !== undefined) update.whatsapp = parseWhatsapp(b.whatsapp);
    if (b.availability !== undefined) update.availability = parseAvailability(b.availability);
    if (b.status !== undefined) {
      if (b.status !== "active" && b.status !== "inactive") return res.status(400).json({ error: "Estado no válido" });
      if (snap.get("status") === "invited") return res.status(400).json({ error: "La persona aún no aceptó la invitación" });
      update.status = b.status;
    }
    await snap.ref.update(update);
    await syncIndex(user.uid, id);
    if (update.status === "inactive" && snap.get("uid")) {
      await getAuth().revokeRefreshTokens(snap.get("uid")).catch(() => {});
    }
    return res.json({ member: toMemberRow(id, (await snap.ref.get()).data()!) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

teamRouter.delete("/:id", authRequired({ perm: "settings.usuarios" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const id = req.params.id as string;
    notSelf(id, user.actor.memberId);
    return res.json(await deleteMember(user.uid, id));
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

teamRouter.post("/:id/link", authRequired({ perm: "settings.usuarios" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const id = req.params.id as string;
    const snap = await getMember(user.uid, id);
    if (snap.get("status") !== "invited") return res.status(400).json({ error: "Esta persona ya aceptó la invitación" });
    const origin = `${req.protocol}://${req.get("host")}`;
    return res.json({ invite: await issueInvite(user.uid, id, snap.get("email"), origin) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

// Public invite routes
export const invitesRouter = Router();

invitesRouter.get("/:token", async (req: Request, res: Response) => {
  try {
    const token = req.params.token as string;
    const db = getFirestore();
    const inv = await db.doc(inviteDoc(hashToken(token))).get();
    if (!inv.exists) return res.status(404).json({ error: "Invitación no válida o ya usada" });
    if (inv.get("expiresAt").toMillis() < Date.now()) {
      return res.status(410).json({ error: "La invitación caducó: pide un enlace nuevo al administrador" });
    }
    const [m, owner] = await Promise.all([
      db.doc(memberDoc(inv.get("ownerUid"), inv.get("memberId"))).get(),
      db.doc(userDoc(inv.get("ownerUid"))).get(),
    ]);
    if (!m.exists || m.get("status") !== "invited") return res.status(404).json({ error: "Invitación no válida o ya usada" });
    return res.json({
      firstName: m.get("firstName") ?? "",
      lastName: m.get("lastName") ?? "",
      email: m.get("email"),
      whatsapp: m.get("whatsapp") ?? "",
      role: roleLabel(m.get("role")),
      company: (owner.get("company.name") as string | undefined) ?? null,
      logoUrl: (owner.get("company.logoUrl") as string | undefined) ?? null,
    });
  } catch (err: any) {
    return res.status(500).json({ error: "Error" });
  }
});

invitesRouter.post("/:token/accept", async (req: Request, res: Response) => {
  try {
    const header = req.headers.authorization ?? "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!bearer) return res.status(401).json({ error: "No autenticado" });
    const user = await getAuth().verifyIdToken(bearer);

    const token = req.params.token as string;
    const body = req.body || {};
    const db = getFirestore();
    const invRef = db.doc(inviteDoc(hashToken(token)));
    const inv = await invRef.get();
    if (!inv.exists) return res.status(404).json({ error: "Invitación no válida o ya usada" });
    if (inv.get("expiresAt").toMillis() < Date.now()) {
      return res.status(410).json({ error: "La invitación caducó: pide un enlace nuevo al administrador" });
    }
    if ((user.email ?? "").toLowerCase() !== inv.get("email")) {
      return res.status(403).json({ error: `Entra con el email de la invitación (${inv.get("email")})` });
    }

    const ownerUid = inv.get("ownerUid") as string;
    const memberId = inv.get("memberId") as string;
    if (user.uid === ownerUid) return res.status(400).json({ error: "Eres el dueño de esta cuenta" });
    if ((await db.doc(memberIndexDoc(user.uid)).get()).exists) {
      return res.status(409).json({ error: "Este usuario ya pertenece a un equipo" });
    }
    const ownTenant = await db.doc(tenantDoc(user.uid)).get();
    if (ownTenant.exists && (ownTenant.get("zernioKey") || ownTenant.get("status") === "active")) {
      return res.status(409).json({ error: "Este email ya tiene su propia cuenta de empresa" });
    }

    const mRef = db.doc(memberDoc(ownerUid, memberId));
    const m = await mRef.get();
    if (!m.exists || m.get("status") !== "invited") return res.status(404).json({ error: "Invitación no válida o ya usada" });

    const authUser = await getAuth().getUser(user.uid);
    const invitedAtSec = Math.floor((m.get("createdAt")?.toMillis() ?? Date.now()) / 1000);
    const createdAccount = Math.floor(new Date(authUser.metadata.creationTime).getTime() / 1000) >= invitedAtSec;
    const whatsapp = body.whatsapp !== undefined ? parseWhatsapp(body.whatsapp) : m.get("whatsapp");

    const batch = db.batch();
    batch.update(mRef, { uid: user.uid, status: "active", whatsapp, createdAccount, inviteHash: FieldValue.delete(), acceptedAt: FieldValue.serverTimestamp() });
    batch.delete(invRef);
    if (ownTenant.exists) batch.delete(ownTenant.ref);
    await batch.commit();
    await syncIndex(ownerUid, memberId);
    const displayName = [m.get("firstName"), m.get("lastName")].filter(Boolean).join(" ");
    await getAuth().updateUser(user.uid, { displayName });
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

