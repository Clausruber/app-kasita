import { HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { memberIndexDoc } from "./paths";

/**
 * Workspace of a callable's caller: owners act on their own uid; team members on their owner's,
 * only while active and with the access key `perm` (same keys as web/src/lib/permissions.ts).
 */
export async function workspaceOf(req: { auth?: { uid: string } }, perm?: string): Promise<string> {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Inicia sesión");
  const idx = await getFirestore().doc(memberIndexDoc(uid)).get();
  if (!idx.exists) return uid;
  if (idx.get("status") !== "active") throw new HttpsError("permission-denied", "Tu acceso fue desactivado por el administrador");
  const perms = (idx.get("perms") as string[] | undefined) ?? [];
  if (perm && !(perms.includes(perm) && (!perm.includes(".") || perms.includes(perm.split(".")[0]))))
    throw new HttpsError("permission-denied", "No tienes acceso a esta acción");
  return idx.get("ownerUid") as string;
}
