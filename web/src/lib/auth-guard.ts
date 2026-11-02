import "server-only";

import { NextResponse } from "next/server";
import type { DecodedIdToken } from "firebase-admin/auth";
import { adminAuth } from "@/lib/firebase/admin";
import { ZernioError } from "@/lib/zernio";
import { type Actor, actorCan, resolveActor } from "@/lib/actor";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function requireUser(req: Request): Promise<DecodedIdToken> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) throw new HttpError(401, "No autenticado");
  try {
    return await adminAuth.verifyIdToken(token);
  } catch {
    throw new HttpError(401, "Token inválido");
  }
}

/** Authenticated request context: `uid` is the WORKSPACE (owner) uid, `actor` says who is acting. */
export type ApiUser = DecodedIdToken & { actor: Actor };
type Opts = { perm?: string; allowInactive?: boolean };

/** Like withUser, but only for the SuperAdmin (custom claim dfRole:"superadmin"). */
export function withSuperAdmin<C>(handler: (req: Request, user: ApiUser, ctx: C) => Promise<Response>) {
  return withUser<C>(async (req, user, ctx) => {
    const { requireSuperAdmin } = await import("@/lib/tenants");
    await requireSuperAdmin(user);
    return handler(req, user, ctx);
  });
}

/**
 * Wraps a route handler: authenticates, resolves the workspace (team members act on their owner's
 * data), checks the member is active and has `perm`, and maps errors to JSON responses.
 */
export function withUser<C>(handler: (req: Request, user: ApiUser, ctx: C) => Promise<Response>, opts: Opts = {}) {
  return async (req: Request, ctx: C) => {
    try {
      const token = await requireUser(req);
      const actor = await resolveActor(token);
      if (!opts.allowInactive && actor.status !== "active") throw new HttpError(403, "Tu acceso fue desactivado por el administrador");
      if (opts.perm && !actorCan(actor, opts.perm)) throw new HttpError(403, "No tienes acceso a esta sección");
      return await handler(req, { ...token, uid: actor.uid, actor }, ctx);
    } catch (err) {
      if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
      if (err instanceof ZernioError)
        return NextResponse.json({ error: err.message, details: err.body }, { status: err.status >= 500 ? 502 : err.status });
      console.error(err);
      return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }
  };
}

/** withUser for a section: the acting user needs the `perm` access key (owners have them all). */
export function withPerm<C>(perm: string, handler: (req: Request, user: ApiUser, ctx: C) => Promise<Response>) {
  return withUser<C>(handler, { perm });
}

/** Throws 403 unless the acting user has `key` (for routes where it depends on the payload). */
export function requirePerm(user: ApiUser, key: string) {
  if (!actorCan(user.actor, key)) throw new HttpError(403, "No tienes acceso a esta sección");
}
