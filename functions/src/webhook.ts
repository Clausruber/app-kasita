import * as crypto from "crypto";
import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import {
  accountsCol,
  conversationMessagesCol,
  conversationsCol,
  postDoc,
  postMessagesCol,
  postsCol,
  zernioAccountIndex,
  zernioPostIndex,
  zernioProfileIndex,
} from "./paths";
import { ZERNIO_WEBHOOK_SECRET, getTenantWebhookSecret } from "./zernio";
import { DF_AI_ENCRYPTION_KEY } from "./crypto";
import { touchClient } from "./clients";

// Payload shapes, limited to the fields we use. See docs.zernio.com/webhooks.
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const db = () => getFirestore();

/** Firestore ids cannot contain "/"; platform ids sometimes do (e.g. Bluesky URIs). */
export const safeId = (id: string) => id.replace(/\//g, "_").slice(0, 1400);

export function isValidSignature(rawBody: Buffer, signature: string | undefined, secret: string) {
  if (!signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Finds the Firebase uid an event belongs to, trying every routing key the payload may carry. */
async function resolveUid(p: Json): Promise<string | null> {
  if (p.post?.metadata?.uid) return p.post.metadata.uid;

  const profileIds = new Set<string>();
  const collect = (v: unknown) => {
    if (!v) return;
    if (typeof v === "string") profileIds.add(v);
    else if (Array.isArray(v)) v.forEach(collect);
    else if (typeof v === "object") {
      const o = v as Json;
      if (o.id || o._id || o.profileId) collect(o.id ?? o._id ?? o.profileId);
      else Object.values(o).forEach(collect);
    }
  };
  collect(p.profiles);
  collect(p.account?.profileId);
  for (const id of profileIds) {
    const s = await db().doc(zernioProfileIndex(id)).get();
    if (s.exists) return s.get("uid");
  }

  const accountIds = [p.account?.id, p.account?.accountId, ...(p.post?.platforms ?? []).map((x: Json) => x.accountId)]
    .filter(Boolean) as string[];
  for (const id of accountIds) {
    const s = await db().doc(zernioAccountIndex(id)).get();
    if (s.exists) return s.get("uid");
  }
  return null;
}

async function handlePostEvent(uid: string, p: Json) {
  const zp = p.post as Json;
  let postId: string | undefined = zp.metadata?.postId;
  if (!postId) {
    const idx = await db().doc(zernioPostIndex(zp.id)).get();
    postId = idx.get("postId");
  }
  if (!postId) return logger.info("post event for unknown post", { zernioPostId: zp.id });

  const ref = db().doc(postDoc(uid, postId));
  const snap = await ref.get();
  if (!snap.exists) return;
  const platforms = ((snap.get("platforms") as Json[]) ?? []).map((t) => {
    const z = (zp.platforms as Json[] | undefined)?.find((x) => x.accountId === t.accountId || x.platform === t.platform);
    return z
      ? {
          ...t,
          status: z.status ?? t.status,
          url: z.publishedUrl ?? t.url ?? null,
          platformPostId: z.platformPostId ?? t.platformPostId ?? null,
          error: z.error ?? null,
        }
      : t;
  });
  await ref.update({
    status: zp.status ?? p.event.replace("post.", ""),
    platforms,
    ...(zp.publishedAt ? { publishedAt: Timestamp.fromDate(new Date(zp.publishedAt)) } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

/** Maps a comment's post to our post doc, creating an "external" stub for posts made outside the app. */
async function ensurePostForComment(uid: string, p: Json): Promise<string> {
  const c = p.comment as Json;
  const zernioPostId: string | undefined = c.postId ?? p.post?.id ?? undefined;
  const platformPostId: string = c.platformPostId ?? p.post?.platformPostId;
  const indexKey = zernioPostId ?? `pp_${safeId(platformPostId)}`;
  const indexRef = db().doc(zernioPostIndex(indexKey));

  return db().runTransaction(async (tx) => {
    const idx = await tx.get(indexRef);
    if (idx.exists) return idx.get("postId") as string;

    const postRef = db().collection(postsCol(uid)).doc(`ext_${safeId(indexKey)}`);
    tx.set(postRef, {
      content: p.post?.content ?? "",
      mediaItems: p.post?.imageUrl ? [{ url: p.post.imageUrl, type: "image" }] : [],
      platforms: [
        {
          platform: c.platform,
          accountId: p.account?.id ?? p.account?.accountId ?? null,
          status: "published",
          url: p.post?.permalink ?? null,
          platformPostId,
        },
      ],
      status: "published",
      scheduledFor: Timestamp.fromDate(new Date(c.createdAt ?? Date.now())),
      zernioPostId: zernioPostId ?? null,
      source: "external",
      commentCount: 0,
      unreadCount: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.set(indexRef, { uid, postId: postRef.id });
    return postRef.id;
  });
}

async function handleComment(uid: string, p: Json) {
  const c = p.comment as Json;
  const postId = await ensurePostForComment(uid, p);
  const postRef = db().doc(postDoc(uid, postId));
  // Doc id = platform comment id: dedupes retries AND our own replies echoed back by Zernio.
  const msgRef = db().collection(postMessagesCol(uid, postId)).doc(safeId(c.id));
  const own = Boolean(c.author?.isOwnAccount);

  const created = await db().runTransaction(async (tx) => {
    if ((await tx.get(msgRef)).exists) return false;
    tx.set(msgRef, {
      kind: "comment",
      uid,
      postId,
      commentId: c.id,
      parentId: c.parentCommentId ?? null,
      platform: c.platform,
      accountId: p.account?.id ?? p.account?.accountId ?? null,
      zernioPostId: c.postId ?? p.post?.id ?? null,
      platformPostId: c.platformPostId ?? p.post?.platformPostId ?? null,
      author: {
        id: c.author?.id ?? null,
        name: c.author?.name ?? c.author?.username ?? "",
        username: c.author?.username ?? null,
        picture: c.author?.picture ?? null,
      },
      text: c.text ?? "",
      direction: own ? "out" : "in",
      read: own,
      hidden: false,
      createdAt: Timestamp.fromDate(new Date(c.createdAt ?? Date.now())),
      eventId: p.id,
    });
    tx.update(postRef, {
      commentCount: FieldValue.increment(1),
      ...(own ? {} : { unreadCount: FieldValue.increment(1) }),
      lastCommentAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
  if (created && !own)
    await touchClient(uid, { platform: c.platform, author: c.author ?? {}, text: c.text ?? "", at: new Date(c.createdAt ?? Date.now()), channel: "comment", postId });
}

async function handleDirectMessage(uid: string, p: Json) {
  const m = p.message as Json;
  const convRef = db().collection(conversationsCol(uid)).doc(safeId(m.conversationId));
  const msgRef = db().collection(conversationMessagesCol(uid, convRef.id)).doc(safeId(m.id));
  const incoming = m.direction === "incoming";

  const created = await db().runTransaction(async (tx) => {
    if ((await tx.get(msgRef)).exists) return false;
    tx.set(msgRef, {
      kind: "dm",
      uid,
      conversationId: m.conversationId,
      platform: m.platform,
      accountId: p.account?.accountId ?? p.account?.id ?? null,
      author: {
        id: m.sender?.id ?? null,
        name: m.sender?.name ?? m.sender?.username ?? "",
        username: m.sender?.username ?? null,
        picture: m.sender?.picture ?? null,
      },
      text: m.text ?? "",
      attachments: m.attachments ?? [],
      direction: incoming ? "in" : "out",
      read: !incoming,
      createdAt: Timestamp.fromDate(new Date(m.sentAt ?? Date.now())),
      eventId: p.id,
    });
    tx.set(
      convRef,
      {
        platform: m.platform,
        accountId: p.account?.accountId ?? p.account?.id ?? null,
        ...(incoming ? { participant: { name: m.sender?.name ?? m.sender?.username ?? "", picture: m.sender?.picture ?? null } } : {}),
        lastMessage: m.text ?? "",
        lastMessageAt: FieldValue.serverTimestamp(),
        // Who spoke last: the follow-up scheduler flags conversations left waiting on us.
        lastDirection: incoming ? "in" : "out",
        ...(incoming ? { unreadCount: FieldValue.increment(1), lastInboundAt: FieldValue.serverTimestamp() } : {}),
      },
      { merge: true },
    );
    return true;
  });
  if (created && incoming)
    await touchClient(uid, {
      platform: m.platform,
      author: { id: m.sender?.id, name: m.sender?.name ?? m.sender?.username, username: m.sender?.username, picture: m.sender?.picture },
      text: m.text ?? "",
      at: new Date(m.sentAt ?? Date.now()),
      channel: "dm",
      conversationId: convRef.id,
    });
}

async function handleAccountDisconnected(uid: string, p: Json) {
  const accountId = p.account?.id ?? p.account?.accountId ?? p.accountId;
  if (!accountId) return;
  await db()
    .collection(accountsCol(uid))
    .doc(accountId)
    .set({ isActive: false, disconnectedReason: p.reason ?? null }, { merge: true });
}

/**
 * One webhook per account (Zernio key): its URL carries ?tenant=<uid> and it is signed with that
 * account's own secret. Without ?tenant= it is the legacy webhook signed with DF_ZERNIO_WEBHOOK_SECRET.
 */
export const kfZernioWebhook = onRequest({ secrets: [ZERNIO_WEBHOOK_SECRET, DF_AI_ENCRYPTION_KEY], cors: false }, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }
  const tenant = typeof req.query.tenant === "string" ? req.query.tenant : null;
  const secret = tenant ? await getTenantWebhookSecret(tenant).catch(() => null) : ZERNIO_WEBHOOK_SECRET.value();
  const signature = req.get("X-Zernio-Signature") ?? req.get("X-Late-Signature");
  if (!secret || !isValidSignature(req.rawBody, signature, secret)) {
    res.status(401).send("Invalid signature");
    return;
  }

  const p = req.body as Json;
  try {
    if (p.event === "webhook.test") {
      logger.info("webhook.test received", { id: p.id });
      res.status(200).send("ok");
      return;
    }
    // The signature proves the event comes from this tenant's Zernio account; the indexes pick the
    // exact owner when several accounts share a key, and must agree with the tenant.
    const resolved = await resolveUid(p);
    if (tenant && resolved && resolved !== tenant) {
      logger.info("event belongs to another account sharing the key", { id: p.id, tenant });
      res.status(200).send("ignored");
      return;
    }
    const uid = resolved ?? tenant;
    if (!uid) {
      // Not ours (or index missing): ack so Zernio does not retry forever.
      logger.warn("could not route event", { id: p.id, event: p.event });
      res.status(200).send("ignored");
      return;
    }

    if (p.event === "comment.received") await handleComment(uid, p);
    else if (p.event === "message.received" || p.event === "message.sent") await handleDirectMessage(uid, p);
    else if (typeof p.event === "string" && p.event.startsWith("post.") && p.post) await handlePostEvent(uid, p);
    else if (p.event === "account.disconnected") await handleAccountDisconnected(uid, p);
    else logger.info("unhandled event", { event: p.event });

    res.status(200).send("ok");
  } catch (err) {
    // Non-2xx makes Zernio retry; writes are idempotent so that is safe.
    logger.error("webhook failed", { id: p.id, event: p.event, err });
    res.status(500).send("error");
  }
});
