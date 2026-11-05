import { Router, Response } from "express";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { authRequired, AuthenticatedRequest } from "../api_middleware";
import { postMessagesCol, postsCol, zernioPostIndex } from "../paths";
import { getProfileForUser, zernio } from "../lib/zernio";

export const inboxRouter = Router();

type Row = {
  id: string;
  accountId: string;
  accountUsername?: string;
  platform: string;
  content?: string;
  createdTime?: string;
  permalink?: string | null;
  picture?: string | null;
  commentCount?: number;
  likeCount?: number;
};

type ZComment = {
  id: string;
  message?: string;
  createdTime?: string;
  from?: { id?: string; name?: string; username?: string; picture?: string | null; isOwner?: boolean };
  likeCount?: number;
  isHidden?: boolean;
  replies?: ZComment[];
};

const safeId = (id: string) => id.replace(/\//g, "_").slice(0, 1400);
const MAX_THREADS = 20;

inboxRouter.post("/sync", authRequired({ perm: "inbox" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const uid = user.uid;
    const profileId = await getProfileForUser(uid, user.email);
    const { data: rows = [] } = await zernio<{ data?: Row[] }>(uid, "/inbox/comments", {
      query: { profileId, limit: "50" },
    });

    const db = getFirestore();
    const postsSnap = await db.collection(postsCol(uid)).get();
    const byPlatformPostId = new Map<string, FirebaseFirestore.DocumentSnapshot>();
    for (const d of postsSnap.docs) {
      for (const t of (d.get("platforms") as { platformPostId?: string }[] | undefined) ?? []) {
        if (t.platformPostId) byPlatformPostId.set(t.platformPostId, d);
      }
    }

    let created = 0;
    let backfilled = 0;

    for (const [i, row] of rows.entries()) {
      let postRef = byPlatformPostId.get(row.id)?.ref;
      if (!postRef) {
        const idx = await db.doc(zernioPostIndex(`pp_${safeId(row.id)}`)).get();
        postRef = idx.exists ? db.doc(`${postsCol(uid)}/${idx.get("postId")}`) : undefined;
      }
      const isNew = !postRef;
      if (!postRef) {
        postRef = db.collection(postsCol(uid)).doc(`ext_pp_${safeId(row.id)}`);
        await db.doc(zernioPostIndex(`pp_${safeId(row.id)}`)).set({ uid, postId: postRef.id });
        created++;
      }

      const existing = isNew ? null : await postRef.get();
      await postRef.set(
        {
          ...(isNew
            ? {
                content: row.content ?? "",
                mediaItems: [],
                platforms: [
                  { platform: row.platform, accountId: row.accountId, status: "published", url: row.permalink ?? null, platformPostId: row.id },
                ],
                status: "published",
                scheduledFor: Timestamp.fromDate(new Date(row.createdTime ?? Date.now())),
                zernioPostId: null,
                source: "external",
                commentCount: 0,
                unreadCount: 0,
                createdAt: FieldValue.serverTimestamp(),
              }
            : !existing?.get("content") && row.content
              ? { content: row.content }
              : {}),
          picture: row.picture ?? null,
          permalink: row.permalink ?? null,
          accountUsername: row.accountUsername ?? null,
          likeCount: row.likeCount ?? 0,
          platformCommentCount: row.commentCount ?? 0,
          syncedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      const have = isNew ? 0 : ((existing?.get("commentCount") as number) ?? 0);
      if (i >= MAX_THREADS || (row.commentCount ?? 0) <= have) continue;

      const thread = await zernio<{ comments?: ZComment[] }>(uid, `/inbox/comments/${encodeURIComponent(row.id)}`, {
        query: { accountId: row.accountId },
      });
      const flat: (ZComment & { parentId: string | null })[] = [];
      for (const c of thread.comments ?? []) {
        flat.push({ ...c, parentId: null });
        for (const r of c.replies ?? []) flat.push({ ...r, parentId: c.id });
      }

      const msgCol = db.collection(postMessagesCol(uid, postRef.id));
      const snaps = flat.length ? await db.getAll(...flat.map((c) => msgCol.doc(safeId(c.id)))) : [];
      const batch = db.batch();
      let added = 0;
      flat.forEach((c, k) => {
        const author = {
          id: c.from?.id ?? null,
          name: c.from?.name ?? c.from?.username ?? "",
          username: c.from?.username ?? null,
          picture: c.from?.picture ?? null,
        };
        if (snaps[k].exists) {
          if (!snaps[k].get("author.picture") && author.picture) batch.update(snaps[k].ref, { "author.picture": author.picture });
          return;
        }
        added++;
        batch.set(snaps[k].ref, {
          kind: "comment",
          uid,
          postId: postRef!.id,
          commentId: c.id,
          parentId: c.parentId,
          platform: row.platform,
          accountId: row.accountId,
          zernioPostId: existing?.get("zernioPostId") ?? null,
          platformPostId: row.id,
          author,
          text: c.message ?? "",
          direction: c.from?.isOwner ? "out" : "in",
          read: true,
          hidden: Boolean(c.isHidden),
          createdAt: Timestamp.fromDate(new Date(c.createdTime ?? Date.now())),
          source: "sync",
        });
      });
      if (added) batch.update(postRef, { commentCount: FieldValue.increment(added), lastCommentAt: FieldValue.serverTimestamp() });
      await batch.commit();
      backfilled += added;
    }

    return res.json({ posts: rows.length, created, backfilled });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

