import { Router, Response } from "express";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { authRequired, AuthenticatedRequest } from "../api_middleware";
import { postsCol, zernioPostIndex } from "../paths";
import { resolveTargets, validateSchedule, PostInput, getOwnedPost } from "../lib/posts-server";
import { zernio } from "../lib/zernio";
import { watermarkMedia } from "../lib/watermark-server";

export const postsRouter = Router();

const EDITABLE = new Set(["scheduled", "draft", "failed"]);

postsRouter.post("/", authRequired({ perm: "posts.create" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const input = req.body as PostInput;
    if (!input.content?.trim() && !input.mediaItems?.length) return res.status(400).json({ error: "El post está vacío" });
    validateSchedule(input);
    const platforms = await resolveTargets(user.uid, input.accountIds ?? []);
    const mediaItems = input.watermark && input.mediaItems?.length ? await watermarkMedia(user.uid, input.mediaItems) : (input.mediaItems ?? []);

    const db = getFirestore();
    const ref = db.collection(postsCol(user.uid)).doc();
    const result = await zernio<{ post: any }>(user.uid, "/posts", {
      method: "POST",
      idempotencyKey: ref.id,
      body: {
        content: input.content ?? "",
        mediaItems,
        platforms,
        ...(input.publishNow ? { publishNow: true } : { scheduledFor: input.scheduledFor }),
        timezone: input.timezone,
        metadata: { uid: user.uid, postId: ref.id },
      },
    });
    const zp = result.post;
    const scheduled = zp.scheduledFor ?? input.scheduledFor ?? new Date().toISOString();
    const batch = db.batch();
    batch.set(ref, {
      content: input.content ?? "",
      mediaItems,
      watermark: !!input.watermark,
      platforms: platforms.map((p) => ({
        ...p,
        status: zp.platforms?.find((z: any) => z.platform === p.platform)?.status ?? zp.status,
        url: zp.platforms?.find((z: any) => z.platform === p.platform)?.publishedUrl ?? null,
      })),
      scheduledFor: Timestamp.fromDate(new Date(scheduled)),
      status: zp.status,
      zernioPostId: zp._id,
      source: "app",
      commentCount: 0,
      unreadCount: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    batch.set(db.doc(zernioPostIndex(zp._id)), { uid: user.uid, postId: ref.id });
    await batch.commit();

    return res.json({ id: ref.id, status: zp.status, scheduledFor: scheduled });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

postsRouter.put("/:postId", authRequired({ perm: "posts.create" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const postId = req.params.postId as string;
    const snap = await getOwnedPost(user.uid, postId);
    if (!EDITABLE.has(snap.get("status"))) return res.status(409).json({ error: "Solo se pueden editar posts no publicados" });

    const input = req.body as PostInput;
    if (input.scheduledFor && Number.isNaN(Date.parse(input.scheduledFor))) return res.status(400).json({ error: "Fecha no válida" });

    await zernio(user.uid, `/posts/${snap.get("zernioPostId")}`, {
      method: "PUT",
      body: {
        ...(input.content !== undefined ? { content: input.content } : {}),
        ...(input.scheduledFor ? { scheduledFor: input.scheduledFor } : {}),
      },
    });
    await snap.ref.update({
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.scheduledFor ? { scheduledFor: Timestamp.fromDate(new Date(input.scheduledFor)) } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

postsRouter.delete("/:postId", authRequired({ perm: "posts.delete" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const postId = req.params.postId as string;
    const snap = await getOwnedPost(user.uid, postId);
    if (snap.get("source") === "app" && EDITABLE.has(snap.get("status"))) {
      await zernio(user.uid, `/posts/${snap.get("zernioPostId")}`, { method: "DELETE" });
      await snap.ref.delete();
    } else {
      await snap.ref.update({ hidden: true, updatedAt: FieldValue.serverTimestamp() });
    }
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

