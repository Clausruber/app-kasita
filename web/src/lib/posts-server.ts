import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { HttpError } from "@/lib/auth-guard";
import { postDoc, zernioAccountIndex } from "@/lib/firebase/paths";

export type PostInput = {
  content?: string;
  accountIds?: string[];
  mediaItems?: { url: string; type?: string }[];
  scheduledFor?: string | null; // ISO with offset
  publishNow?: boolean;
  timezone?: string;
};

/** Resolves account ids to Zernio platform targets, ensuring they belong to the user. */
export async function resolveTargets(uid: string, accountIds: string[]) {
  if (!accountIds.length) throw new HttpError(400, "Selecciona al menos una cuenta");
  const snaps = await adminDb.getAll(...accountIds.map((id) => adminDb.doc(zernioAccountIndex(id))));
  return snaps.map((s) => {
    if (!s.exists || s.get("uid") !== uid) throw new HttpError(403, "Cuenta no permitida");
    return { platform: s.get("platform") as string, accountId: s.id };
  });
}

export async function getOwnedPost(uid: string, postId: string) {
  const snap = await adminDb.doc(postDoc(uid, postId)).get();
  if (!snap.exists) throw new HttpError(404, "Post no encontrado");
  return snap;
}

export function validateSchedule(input: PostInput) {
  if (input.publishNow) return;
  if (!input.scheduledFor || Number.isNaN(Date.parse(input.scheduledFor)))
    throw new HttpError(400, "Indica una fecha de programación válida");
}
