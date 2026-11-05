import { Router, Response } from "express";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { authRequired, AuthenticatedRequest } from "../api_middleware";
import {
  accountsCol,
  conversationsCol,
  postMessagesCol,
  postsCol,
  zernioAccountIndex,
  zernioPostIndex,
} from "../paths";
import { getProfileForUser, indexAccounts, zernio, ZernioAccount, ZernioError } from "../lib/zernio";
import { PLATFORMS } from "../lib/platforms";

export const accountsRouter = Router();

const safeId = (id: string) => id.replace(/\//g, "_").slice(0, 1400);

accountsRouter.get("/", authRequired(), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const profileId = await getProfileForUser(user.uid, user.email);
    const { accounts } = await zernio<{ accounts: ZernioAccount[] }>(user.uid, "/accounts", { query: { profileId } });

    await indexAccounts(user.uid, accounts);
    const db = getFirestore();
    const col = db.collection(accountsCol(user.uid));
    const batch = db.batch();
    for (const a of accounts) {
      batch.set(
        col.doc(a._id),
        {
          platform: a.platform,
          username: a.username ?? a.displayName ?? null,
          picture: a.profilePicture ?? null,
          isActive: a.isActive ?? true,
        },
        { merge: true },
      );
    }
    await batch.commit();
    return res.json({ accounts });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

accountsRouter.post("/connect", authRequired({ perm: "settings.redes" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const { platform } = req.body || {};
    if (!platform || !PLATFORMS.some((p) => p.id === platform)) {
      return res.status(400).json({ error: "Plataforma no válida" });
    }
    const profileId = await getProfileForUser(user.uid, user.email);
    const origin = `${req.protocol}://${req.get("host")}`;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || origin;
    const { authUrl } = await zernio<{ authUrl: string }>(user.uid, `/connect/${platform}`, {
      query: { profileId, redirect_url: `${appUrl}/callback` },
    });
    return res.json({ authUrl });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

accountsRouter.delete("/:accountId", authRequired({ perm: "settings.redes" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const accountId = req.params.accountId as string;
    const uid = user.uid;
    const db = getFirestore();
    const index = await db.doc(zernioAccountIndex(accountId)).get();
    if (index.get("uid") !== uid) return res.status(404).json({ error: "Cuenta no encontrada" });

    await zernio(uid, `/accounts/${accountId}`, { method: "DELETE" }).catch((e) => {
      if (!(e instanceof ZernioError && e.status === 404)) throw e;
    });

    let posts = 0;
    let conversations = 0;
    const postsSnap = await db.collection(postsCol(uid)).get();
    for (const doc of postsSnap.docs) {
      const targets = (doc.get("platforms") as any[] | undefined) ?? [];
      const mine = targets.filter((t) => t.accountId === accountId);
      if (!mine.length) continue;

      if (mine.length === targets.length) {
        const zernioPostId = doc.get("zernioPostId") as string | null | undefined;
        const indexKeys = [
          ...(zernioPostId ? [zernioPostId] : []),
          ...mine.flatMap((t) => (t.platformPostId ? [`pp_${safeId(t.platformPostId)}`] : [])),
        ];
        await Promise.all(
          indexKeys.map(async (k) => {
            const snap = await db.doc(zernioPostIndex(k)).get();
            if (snap.exists && snap.get("uid") === uid) await snap.ref.delete();
          }),
        );
        await db.recursiveDelete(doc.ref);
        posts++;
      } else {
        const msgs = await db.collection(postMessagesCol(uid, doc.id)).where("accountId", "==", accountId).get();
        for (let i = 0; i < msgs.docs.length; i += 400) {
          const batch = db.batch();
          msgs.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
          await batch.commit();
        }
        await Promise.all(
          mine.flatMap((t) =>
            t.platformPostId
              ? [
                  (async () => {
                    const snap = await db.doc(zernioPostIndex(`pp_${safeId(t.platformPostId)}`)).get();
                    if (snap.exists && snap.get("uid") === uid) await snap.ref.delete();
                  })(),
                ]
              : [],
          ),
        );
        await doc.ref.update({
          platforms: targets.filter((t) => t.accountId !== accountId),
          ...(msgs.size ? { commentCount: FieldValue.increment(-msgs.size) } : {}),
        });
      }
    }

    const convs = await db.collection(conversationsCol(uid)).where("accountId", "==", accountId).get();
    for (const c of convs.docs) {
      await db.recursiveDelete(c.ref);
      conversations++;
    }

    await Promise.all([
      db.doc(zernioAccountIndex(accountId)).delete(),
      db.collection(accountsCol(uid)).doc(accountId).delete(),
    ]);

    return res.json({ ok: true, deletedPosts: posts, deletedConversations: conversations });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

