import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpError, withPerm } from "@/lib/auth-guard";
import { getOwnedPost, type PostInput } from "@/lib/posts-server";
import { zernio } from "@/lib/zernio";

type Ctx = { params: Promise<{ postId: string }> };

const EDITABLE = new Set(["scheduled", "draft", "failed"]);

// Edits the text or the date of a post that has not been published yet.
export const PUT = withPerm<Ctx>("posts.create", async (req, user, { params }) => {
  const { postId } = await params;
  const snap = await getOwnedPost(user.uid, postId);
  if (!EDITABLE.has(snap.get("status"))) throw new HttpError(409, "Solo se pueden editar posts no publicados");

  const input = (await req.json()) as PostInput;
  if (input.scheduledFor && Number.isNaN(Date.parse(input.scheduledFor))) throw new HttpError(400, "Fecha no válida");

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
  return NextResponse.json({ ok: true });
});

// Deletes the post in Zernio and in Firestore (comments stay attached only if it was published).
export const DELETE = withPerm<Ctx>("posts.delete", async (_req, user, { params }) => {
  const { postId } = await params;
  const snap = await getOwnedPost(user.uid, postId);
  if (snap.get("source") === "app" && EDITABLE.has(snap.get("status"))) {
    await zernio(user.uid, `/posts/${snap.get("zernioPostId")}`, { method: "DELETE" });
    await snap.ref.delete();
  } else {
    // Already published: keep the doc (it holds the comments), just hide it from the calendar.
    await snap.ref.update({ hidden: true, updatedAt: FieldValue.serverTimestamp() });
  }
  return NextResponse.json({ ok: true });
});
