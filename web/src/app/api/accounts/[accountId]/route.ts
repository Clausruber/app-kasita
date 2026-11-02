import { NextResponse } from "next/server";
import { HttpError, withPerm } from "@/lib/auth-guard";
import { adminDb } from "@/lib/firebase/admin";
import { accountsCol, zernioAccountIndex } from "@/lib/firebase/paths";
import { zernio } from "@/lib/zernio";

type Ctx = { params: Promise<{ accountId: string }> };

// Disconnects a social account.
export const DELETE = withPerm<Ctx>("settings.redes", async (_req, user, { params }) => {
  const { accountId } = await params;
  const index = await adminDb.doc(zernioAccountIndex(accountId)).get();
  if (index.get("uid") !== user.uid) throw new HttpError(404, "Cuenta no encontrada");

  await zernio(user.uid, `/accounts/${accountId}`, { method: "DELETE" });
  await Promise.all([
    adminDb.doc(zernioAccountIndex(accountId)).delete(),
    adminDb.collection(accountsCol(user.uid)).doc(accountId).delete(),
  ]);
  return NextResponse.json({ ok: true });
});
