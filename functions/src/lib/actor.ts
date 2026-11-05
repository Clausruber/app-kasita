
import type { DecodedIdToken } from "firebase-admin/auth";
import { adminDb } from "./firebase/admin";
import { memberIndexDoc } from "./firebase/paths";
import { type TeamRole, can, normalisePerms } from "./permissions";

/**
 * Who is acting and on which workspace. The workspace is the owner's uid (all data lives under
 * DEMO-FIREBASE/{ownerUid}); team members are mapped to it by the server-only index
 * _system/members/{memberUid}, written when they accept an invitation.
 */
export type Actor = {
  authUid: string; // the signed-in user
  uid: string; // the workspace (owner) uid
  email: string | null;
  isOwner: boolean;
  role: "owner" | TeamRole;
  perms: string[] | null; // null = owner, everything allowed
  memberId: string | null;
  status: "active" | "inactive";
};

export async function resolveActor(token: DecodedIdToken): Promise<Actor> {
  const idx = await adminDb.doc(memberIndexDoc(token.uid)).get();
  if (!idx.exists) {
    return { authUid: token.uid, uid: token.uid, email: token.email ?? null, isOwner: true, role: "owner", perms: null, memberId: null, status: "active" };
  }
  return {
    authUid: token.uid,
    uid: idx.get("ownerUid") as string,
    email: token.email ?? null,
    isOwner: false,
    role: (idx.get("role") as TeamRole) ?? "team",
    perms: normalisePerms(idx.get("perms")),
    memberId: idx.get("memberId") as string,
    status: idx.get("status") === "active" ? "active" : "inactive",
  };
}

export const actorCan = (a: Actor, key: string) => can(a.perms, key);
