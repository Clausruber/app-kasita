import { Request, Response, NextFunction } from "express";
import { getAuth, DecodedIdToken } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { memberIndexDoc } from "./paths";
import { isSuperAdmin } from "./lib/tenants";
import { can } from "./lib/permissions";

export type Actor = {
  authUid: string;
  uid: string; // workspace (owner) uid
  email: string | null;
  isOwner: boolean;
  role: "owner" | "team" | "supervisor" | "admin";
  perms: string[] | null;
  memberId: string | null;
  status: "active" | "inactive";
};

export type AuthUser = DecodedIdToken & {
  uid: string; // workspace (owner) uid
  actor: Actor;
};

export interface AuthenticatedRequest extends Request {
  user: AuthUser;
}

export function authRequired(opts: { perm?: string; allowInactive?: boolean; superAdmin?: boolean } = {}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const header = req.headers.authorization ?? "";
      const token = header.startsWith("Bearer ") ? header.slice(7) : null;
      if (!token) return res.status(401).json({ error: "No autenticado" });

      const decoded = await getAuth().verifyIdToken(token);
      const db = getFirestore();
      const idx = await db.doc(memberIndexDoc(decoded.uid)).get();

      let actor: Actor;
      if (!idx.exists) {
        actor = {
          authUid: decoded.uid,
          uid: decoded.uid,
          email: decoded.email ?? null,
          isOwner: true,
          role: "owner",
          perms: null,
          memberId: null,
          status: "active",
        };
      } else {
        const perms = (idx.get("perms") as string[] | undefined) ?? [];
        actor = {
          authUid: decoded.uid,
          uid: idx.get("ownerUid") as string,
          email: decoded.email ?? null,
          isOwner: false,
          role: idx.get("role") ?? "team",
          perms,
          memberId: idx.get("memberId") as string,
          status: idx.get("status") === "active" ? "active" : "inactive",
        };
      }

      if (!opts.allowInactive && actor.status !== "active") {
        return res.status(403).json({ error: "Tu acceso fue desactivado por el administrador" });
      }

      if (opts.perm && !can(actor.perms, opts.perm)) {
        return res.status(403).json({ error: "No tienes acceso a esta sección" });
      }

      if (opts.superAdmin) {
        const admin = await isSuperAdmin(decoded);
        if (!admin) {
          return res.status(403).json({ error: "Solo el SuperAdmin puede hacer esto" });
        }
      }

      (req as AuthenticatedRequest).user = { ...decoded, uid: actor.uid, actor };
      next();
    } catch (err: any) {
      return res.status(401).json({ error: "Token inválido o expirado" });
    }
  };
}

