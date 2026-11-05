import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { HttpError, withPerm } from "@/lib/auth-guard";
import { adminDb } from "@/lib/firebase/admin";
import {
  accountsCol,
  conversationsCol,
  postMessagesCol,
  postsCol,
  zernioAccountIndex,
  zernioPostIndex,
} from "@/lib/firebase/paths";
import { zernio, ZernioError } from "@/lib/zernio";

type Ctx = { params: Promise<{ accountId: string }> };
type Target = { accountId?: string | null; platformPostId?: string };

const safeId = (id: string) => id.replace(/\//g, "_").slice(0, 1400);

// Disconnects a social account and deletes its posts, comments and conversations.
// Contacts (Clientes) are kept: they are CRM data.
export const DELETE = withPerm<Ctx>("settings.redes", async (_req, user, { params }) => {
  const { accountId } = await params;
  const uid = user.uid;
  const index = await adminDb.doc(zernioAccountIndex(accountId)).get();
  if (index.get("uid") !== uid) throw new HttpError(404, "Cuenta no encontrada");

  // Already gone in Zernio → still clean up our side.
  await zernio(uid, `/accounts/${accountId}`, { method: "DELETE" }).catch((e) => {
    if (!(e instanceof ZernioError && e.status === 404)) throw e;
  });

  const removed = await purgeAccountData(uid, accountId);
  await Promise.all([
    adminDb.doc(zernioAccountIndex(accountId)).delete(),
    adminDb.collection(accountsCol(uid)).doc(accountId).delete(),
  ]);
  return NextResponse.json({ ok: true, ...removed });
});

async function purgeAccountData(uid: string, accountId: string) {
  let posts = 0;
  let conversations = 0;

  // Posts: delete those published only on this account (with their comments and lookup
  // indexes); for multi-account posts just drop this account's target and its comments.
  const postsSnap = await adminDb.collection(postsCol(uid)).get();
  for (const doc of postsSnap.docs) {
    const targets = (doc.get("platforms") as Target[] | undefined) ?? [];
    const mine = targets.filter((t) => t.accountId === accountId);
    if (!mine.length) continue;

    if (mine.length === targets.length) {
      const zernioPostId = doc.get("zernioPostId") as string | null | undefined;
      const indexKeys = [
        ...(zernioPostId ? [zernioPostId] : []),
        ...mine.flatMap((t) => (t.platformPostId ? [`pp_${safeId(t.platformPostId)}`] : [])),
      ];
      await Promise.all(indexKeys.map((k) => deleteIndexIfOwned(zernioPostIndex(k), uid)));
      await adminDb.recursiveDelete(doc.ref);
      posts++;
    } else {
      const msgs = await adminDb.collection(postMessagesCol(uid, doc.id)).where("accountId", "==", accountId).get();
      await deleteDocs(msgs.docs.map((d) => d.ref));
      await Promise.all(
        mine.flatMap((t) => (t.platformPostId ? [deleteIndexIfOwned(zernioPostIndex(`pp_${safeId(t.platformPostId)}`), uid)] : [])),
      );
      await doc.ref.update({
        platforms: targets.filter((t) => t.accountId !== accountId),
        ...(msgs.size ? { commentCount: FieldValue.increment(-msgs.size) } : {}),
      });
    }
  }

  // Direct-message conversations of this account (with their messages).
  const convs = await adminDb.collection(conversationsCol(uid)).where("accountId", "==", accountId).get();
  for (const c of convs.docs) {
    await adminDb.recursiveDelete(c.ref);
    conversations++;
  }

  return { deletedPosts: posts, deletedConversations: conversations };
}

async function deleteIndexIfOwned(path: string, uid: string) {
  const snap = await adminDb.doc(path).get();
  if (snap.exists && snap.get("uid") === uid) await snap.ref.delete();
}

async function deleteDocs(refs: FirebaseFirestore.DocumentReference[]) {
  for (let i = 0; i < refs.length; i += 400) {
    const batch = adminDb.batch();
    refs.slice(i, i + 400).forEach((r) => batch.delete(r));
    await batch.commit();
  }
}
