import "server-only";

import type { DecodedIdToken } from "firebase-admin/auth";
import { HttpError } from "@/lib/auth-guard";
import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { tenantDoc } from "@/lib/firebase/paths";
import { decrypt } from "@/lib/ai-crypto";

export type TenantStatus = "pending" | "active" | "disabled";

/**
 * SuperAdmin = custom claim dfRole:"superadmin" (own claim name: the Auth project is shared with
 * another app that uses "role"). Read from Auth, not the token, so a claim set by script works
 * without the user signing in again.
 */
export async function isSuperAdmin(user: DecodedIdToken) {
  if (user.dfRole === "superadmin") return true;
  // `uid` may be the workspace of a team member: always check the signed-in user.
  const record = await adminAuth.getUser((user.actor as { authUid?: string } | undefined)?.authUid ?? user.uid);
  return record.customClaims?.dfRole === "superadmin";
}

/** Registers the account in this app on first sign-in (pending until the SuperAdmin activates it). */
export async function ensureTenant(user: DecodedIdToken) {
  const ref = adminDb.doc(tenantDoc(user.uid));
  await adminDb.runTransaction(async (tx) => {
    if ((await tx.get(ref)).exists) return;
    tx.set(ref, { status: "pending", email: user.email ?? null, registeredAt: FieldValue.serverTimestamp() });
  });
}

export async function requireSuperAdmin(user: DecodedIdToken) {
  if (!(await isSuperAdmin(user))) throw new HttpError(403, "Solo el SuperAdmin puede hacer esto");
}

export async function tenantStatus(uid: string): Promise<TenantStatus> {
  const snap = await adminDb.doc(tenantDoc(uid)).get();
  return (snap.get("status") as TenantStatus | undefined) ?? "pending";
}

/** The account's own Zernio API key. Accounts not activated by the SuperAdmin cannot use Zernio. */
export async function getTenantZernioKey(uid: string): Promise<string> {
  const snap = await adminDb.doc(tenantDoc(uid)).get();
  const status = (snap.get("status") as TenantStatus | undefined) ?? "pending";
  if (status === "disabled") throw new HttpError(403, "Tu cuenta está desactivada. Contacta con el administrador.");
  const enc = snap.get("zernioKey") as string | undefined;
  if (status !== "active") throw new HttpError(403, "Tu cuenta está pendiente de activación por el administrador.");
  if (!enc) throw new HttpError(409, "La conexión con las redes sociales aún no está configurada. El administrador la activará pronto.");
  return decrypt(enc);
}
