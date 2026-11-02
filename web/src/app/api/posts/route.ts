import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpError, withPerm } from "@/lib/auth-guard";
import { adminDb } from "@/lib/firebase/admin";
import { postsCol, zernioPostIndex } from "@/lib/firebase/paths";
import { resolveTargets, validateSchedule, type PostInput } from "@/lib/posts-server";
import { zernio } from "@/lib/zernio";

type ZernioPost = {
  _id: string;
  status: string;
  scheduledFor?: string;
  platforms?: { platform: string; status?: string; platformPostUrl?: string; publishedUrl?: string }[];
};

// Creates (schedules or publishes) a post. Firestore is the source of truth for the UI;
// Zernio gets { uid, postId } as metadata so webhooks can be mapped back.
export const POST = withPerm("posts.create", async (req, user) => {
  const input = (await req.json()) as PostInput;
  if (!input.content?.trim() && !input.mediaItems?.length) throw new HttpError(400, "El post está vacío");
  validateSchedule(input);
  const platforms = await resolveTargets(user.uid, input.accountIds ?? []);

  const ref = adminDb.collection(postsCol(user.uid)).doc();
  const res = await zernio<{ post: ZernioPost }>(user.uid, "/posts", {
    method: "POST",
    idempotencyKey: ref.id,
    body: {
      content: input.content ?? "",
      mediaItems: input.mediaItems ?? [],
      platforms,
      ...(input.publishNow ? { publishNow: true } : { scheduledFor: input.scheduledFor }),
      timezone: input.timezone,
      metadata: { uid: user.uid, postId: ref.id },
    },
  });
  const zp = res.post;

  const scheduled = zp.scheduledFor ?? input.scheduledFor ?? new Date().toISOString();
  const batch = adminDb.batch();
  batch.set(ref, {
    content: input.content ?? "",
    mediaItems: input.mediaItems ?? [],
    platforms: platforms.map((p) => ({
      ...p,
      status: zp.platforms?.find((z) => z.platform === p.platform)?.status ?? zp.status,
      url: zp.platforms?.find((z) => z.platform === p.platform)?.platformPostUrl ?? null,
    })),
    status: zp.status,
    scheduledFor: Timestamp.fromDate(new Date(scheduled)),
    timezone: input.timezone ?? null,
    zernioPostId: zp._id,
    source: "app",
    commentCount: 0,
    unreadCount: 0,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  batch.set(adminDb.doc(zernioPostIndex(zp._id)), { uid: user.uid, postId: ref.id });
  await batch.commit();

  return NextResponse.json({ id: ref.id, status: zp.status }, { status: 201 });
});
