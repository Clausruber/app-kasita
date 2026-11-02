import "server-only";

import crypto from "crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpError } from "@/lib/auth-guard";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { inviteDoc, memberDoc, memberIndexDoc, membersCol } from "@/lib/firebase/paths";
import { ROLE_PRESETS, TEAM_ROLES, type TeamRole, normalisePerms } from "@/lib/permissions";

export const INVITE_DAYS = 7;
const clip = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
export const hashToken = (t: string) => crypto.createHash("sha256").update(t).digest("hex");

export type MemberRow = {
  id: string;
  uid: string | null;
  firstName: string;
  lastName: string;
  email: string;
  whatsapp: string;
  photoURL: string | null;
  role: TeamRole;
  perms: string[];
  status: "invited" | "active" | "inactive";
  inviteExpiresAt: string | null;
  createdAt: string | null;
  acceptedAt: string | null;
};

const iso = (v: unknown) => (v instanceof Timestamp ? v.toDate().toISOString() : null);
export const toMemberRow = (id: string, d: FirebaseFirestore.DocumentData): MemberRow => ({
  id,
  uid: d.uid ?? null,
  firstName: d.firstName ?? "",
  lastName: d.lastName ?? "",
  email: d.email ?? "",
  whatsapp: d.whatsapp ?? "",
  photoURL: d.photoURL ?? null,
  role: d.role ?? "team",
  perms: normalisePerms(d.perms),
  status: d.status ?? "invited",
  inviteExpiresAt: iso(d.inviteExpiresAt),
  createdAt: iso(d.createdAt),
  acceptedAt: iso(d.acceptedAt),
});

export function parseRole(v: unknown): TeamRole {
  if (!TEAM_ROLES.some((r) => r.id === v)) throw new HttpError(400, "Rol no válido");
  return v as TeamRole;
}

export function parseWhatsapp(v: unknown) {
  const w = clip(v, 30).replace(/[\s().-]/g, "");
  if (w && !/^\+?\d{6,15}$/.test(w)) throw new HttpError(400, "WhatsApp no válido: usa el número con prefijo de país");
  return w && !w.startsWith("+") ? `+${w}` : w;
}

export function parseInvite(b: Record<string, unknown>) {
  const firstName = clip(b.firstName, 80);
  const lastName = clip(b.lastName, 120);
  const email = clip(b.email, 200).toLowerCase();
  if (!firstName) throw new HttpError(400, "Indica el nombre");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Email no válido");
  const role = parseRole(b.role);
  return { firstName, lastName, email, whatsapp: parseWhatsapp(b.whatsapp), role, perms: b.perms ? normalisePerms(b.perms) : ROLE_PRESETS[role] };
}

/** Public base URL for invitation links (the app's own origin). */
export function appOrigin(req: Request) {
  return process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
}

/**
 * Issues a fresh single-use invitation link for a member (any previous link stops working).
 * Only the token's hash is stored: the link is shown once, when created or regenerated.
 */
export async function issueInvite(ownerUid: string, memberId: string, email: string, origin: string) {
  const token = crypto.randomBytes(24).toString("base64url");
  const hash = hashToken(token);
  const expiresAt = Timestamp.fromMillis(Date.now() + INVITE_DAYS * 86400_000);
  const ref = adminDb.doc(memberDoc(ownerUid, memberId));
  const prev = (await ref.get()).get("inviteHash") as string | undefined;
  const batch = adminDb.batch();
  if (prev) batch.delete(adminDb.doc(inviteDoc(prev)));
  batch.set(adminDb.doc(inviteDoc(hash)), { ownerUid, memberId, email, expiresAt });
  batch.update(ref, { inviteHash: hash, inviteExpiresAt: expiresAt, updatedAt: FieldValue.serverTimestamp() });
  await batch.commit();
  return { url: `${origin}/register?invite=${token}`, expiresAt: expiresAt.toDate().toISOString() };
}

export async function getMember(ownerUid: string, memberId: string) {
  const snap = await adminDb.doc(memberDoc(ownerUid, memberId)).get();
  if (!snap.exists) throw new HttpError(404, "Usuario no encontrado");
  return snap;
}

/** Keeps the server-only index (used by the API, the functions and the Firestore rules) in sync. */
export async function syncIndex(ownerUid: string, memberId: string) {
  const m = (await adminDb.doc(memberDoc(ownerUid, memberId)).get()).data();
  if (!m?.uid) return;
  await adminDb.doc(memberIndexDoc(m.uid)).set({
    ownerUid,
    memberId,
    role: m.role,
    perms: normalisePerms(m.perms),
    status: m.status === "active" ? "active" : "inactive",
    email: m.email ?? null,
    photoURL: m.photoURL ?? null,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

/**
 * Removes a member: their access (index + pending invite) and, when the Auth account was created by
 * accepting this invitation and is used by nothing else, the account itself. Auth is shared with
 * another app, so an account that existed before the invitation is kept.
 */
export async function deleteMember(ownerUid: string, memberId: string) {
  const snap = await getMember(ownerUid, memberId);
  const m = snap.data()!;
  const batch = adminDb.batch();
  if (m.inviteHash) batch.delete(adminDb.doc(inviteDoc(m.inviteHash)));
  if (m.uid) batch.delete(adminDb.doc(memberIndexDoc(m.uid)));
  batch.delete(snap.ref);
  await batch.commit();
  if (!m.uid) return { accountDeleted: false };
  await adminAuth.revokeRefreshTokens(m.uid).catch(() => {});
  if (m.createdAccount) {
    const u = await adminAuth.getUser(m.uid).catch(() => null);
    if (u && !Object.keys(u.customClaims ?? {}).length) {
      await adminAuth.deleteUser(m.uid);
      return { accountDeleted: true };
    }
  }
  return { accountDeleted: false };
}

export const listMembers = async (ownerUid: string) =>
  (await adminDb.collection(membersCol(ownerUid)).orderBy("createdAt", "desc").get()).docs.map((d) => toMemberRow(d.id, d.data()));
