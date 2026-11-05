import { HttpsError, onCall } from "firebase-functions/v2/https";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { conversationMessagesCol, conversationsCol, postDoc, postMessagesCol } from "./paths";
import { safeId } from "./webhook";
import { ZernioError, getTenantZernioKey, zernio } from "./zernio";
import { DF_AI_ENCRYPTION_KEY } from "./crypto";
import { workspaceOf } from "./actor";
import { confirmBooking, releaseHold } from "./agenda";
import { type ClientProposal, applyClientProposal } from "./clients";
import { createCommentQuote, deleteQuote } from "./quotes";

type BookingAction = "confirm" | "cancel";
type QuoteAction = "send" | "skip";
/** Quote the agent proposes for a comment: created and sent by private reply (DM) when the reply goes out. */
export type DraftQuote = { propertyId: string; title: string };
type SentQuote = { id: string; folio: string; propertyTitle: string; messageId: string | null };
// Meta only allows private replies (a DM to whoever commented) on these networks.
export const PRIVATE_REPLY_PLATFORMS = ["instagram", "facebook"];
type DraftBooking = { id: string; service: string; label: string; start: number };
export type DmAttachment = { url: string; name: string; type: "file" | "image" };

type SendOpts = {
  attachmentUrl?: string;
  attachment?: DmAttachment | null; // DMs: a file (catalog PDF) or an image
  requestId?: string;
  sentBy: "user" | "ai";
  booking?: BookingAction;
  // Booking proposed in this run (automatic mode, no draft stored); otherwise the message's aiDraft.booking.
  proposed?: DraftBooking | null;
  // Save the client data the agent collected (message's aiDraft.client, or proposedClient in automatic mode).
  saveClient?: boolean;
  proposedClient?: ClientProposal | null;
  // Comments: send the proposed quote by private reply (message's aiDraft.quote, or proposedQuote in automatic mode).
  quote?: QuoteAction;
  proposedQuote?: DraftQuote | null;
};

/** Saves the agent's client-data proposal when the reply goes out (if the owner kept it ticked). */
async function settleClient(uid: string, msg: FirebaseFirestore.DocumentSnapshot | null, opts: SendOpts) {
  const p = opts.proposedClient ?? (msg?.get("aiDraft.client") as ClientProposal | null | undefined);
  if (!p || !opts.saveClient) return null;
  return applyClientProposal(uid, p);
}

/**
 * Settles the booking an AI draft proposed (held slot), before the reply goes out: confirming it can
 * fail if the hold expired and someone else took the slot, and then the reply must not be sent.
 */
async function settleBooking(uid: string, msg: FirebaseFirestore.DocumentSnapshot | null, opts: SendOpts) {
  const action = opts.booking;
  const b = opts.proposed ?? (msg?.get("aiDraft.booking") as DraftBooking | null | undefined);
  if (!b?.id || !action) return null;
  if (action === "cancel") {
    await releaseHold(uid, b.id);
    return null;
  }
  await confirmBooking(uid, b.id);
  return { id: b.id, service: b.service, label: b.label, start: b.start, status: "confirmed" };
}

const db = () => getFirestore();

/**
 * Creates the quote the agent proposed and sends its public link to the commenter by private reply,
 * before the public answer (which says "te lo enviamos por mensaje privado") goes out. Meta allows one
 * private reply per comment, within 7 days, text only: so the link, never the PDF.
 */
async function settleQuote(
  uid: string,
  key: string,
  msg: FirebaseFirestore.DocumentSnapshot | null,
  ctx: { accountId: string; zernioPostRef: string; platform: string | null },
  opts: SendOpts,
): Promise<SentQuote | null> {
  const q = opts.proposedQuote ?? (msg?.get("aiDraft.quote") as DraftQuote | null | undefined);
  if (opts.quote !== "send" || !q?.propertyId || !msg) return null;
  // Already sent on an earlier attempt (e.g. the public reply failed afterwards): never DM twice.
  const done = msg.get("quoteDm") as SentQuote | undefined;
  if (done) return done;
  if (!ctx.platform || !PRIVATE_REPLY_PLATFORMS.includes(ctx.platform))
    throw new HttpsError("failed-precondition", "Solo Instagram y Facebook permiten enviar un mensaje privado a quien comentó");

  const quote = await createCommentQuote(uid, q.propertyId, { platform: ctx.platform, author: msg.get("author") ?? {} }).catch((e: Error) => {
    throw new HttpsError("failed-precondition", e.message);
  });
  const first = quote.clientName.split(/\s+/)[0];
  const text = [
    `¡Hola${first ? ` ${first}` : ""}! 👋 Gracias por tu interés en ${quote.propertyTitle}.`,
    `Aquí tienes tu cotización con precio, fotos y detalles: ${quote.link}`,
    "Si quieres agendar una visita o tienes dudas, escríbenos por aquí.",
  ].join("\n");
  // Zernio takes the platform's post id (IG media / FB post) here; fall back to the one used for comments.
  const postRef = (msg.get("platformPostId") as string | null) || ctx.zernioPostRef;
  try {
    const res = await zernio<{ messageId?: string; data?: { messageId?: string } }>(
      key,
      `/inbox/comments/${encodeURIComponent(postRef)}/${encodeURIComponent(msg.get("commentId"))}/private-reply`,
      { method: "POST", idempotencyKey: opts.requestId ? `${opts.requestId}_dm`.slice(0, 64) : undefined, body: { accountId: ctx.accountId, message: text } },
    );
    const sent: SentQuote = { id: quote.id, folio: quote.folio, propertyTitle: quote.propertyTitle, messageId: res.messageId ?? res.data?.messageId ?? null };
    await msg.ref.update({ quoteDm: { ...sent, at: FieldValue.serverTimestamp() } });
    return sent;
  } catch (e) {
    const err = e as Error;
    const z = e instanceof ZernioError ? e : null;
    // 502 "unknown": Meta probably delivered it. Keep the quote (its link may be in the DM) and stop.
    if (z?.status === 502 || z?.details?.privateReplyOutcome === "unknown") {
      await msg.ref.update({ quoteDm: { id: quote.id, folio: quote.folio, propertyTitle: quote.propertyTitle, messageId: null, uncertain: true, at: FieldValue.serverTimestamp() } });
      throw new HttpsError("unavailable", `No sabemos si el mensaje privado llegó (${quote.folio}). Revisa los mensajes directos antes de responder el comentario.`);
    }
    await deleteQuote(uid, quote.id, quote.token).catch(() => {});
    if (z?.details?.privateReplyConsumed)
      throw new HttpsError("failed-precondition", "Ya se envió un mensaje privado a este comentario: manda la cotización desde sus mensajes directos.");
    throw new HttpsError("failed-precondition", `No se pudo enviar la cotización por mensaje privado: ${err.message}`);
  }
}

async function loadContext(uid: string, postId: string, messageId?: string) {
  const postSnap = await db().doc(postDoc(uid, postId)).get();
  if (!postSnap.exists) throw new HttpsError("not-found", "Post no encontrado");
  const msgSnap = messageId ? await db().collection(postMessagesCol(uid, postId)).doc(messageId).get() : null;
  if (messageId && !msgSnap?.exists) throw new HttpsError("not-found", "Comentario no encontrado");

  const target = (postSnap.get("platforms") as { accountId?: string; platformPostId?: string }[] | undefined)?.[0];
  const accountId = (msgSnap?.get("accountId") as string | null) ?? target?.accountId;
  // Zernio accepts its own post id or the platform's post id.
  const zernioPostRef =
    (postSnap.get("zernioPostId") as string | null) ??
    (msgSnap?.get("platformPostId") as string | null) ??
    target?.platformPostId;
  if (!accountId || !zernioPostRef) throw new HttpsError("failed-precondition", "Falta la cuenta o el post de Zernio");
  return { postSnap, msgSnap, accountId, zernioPostRef };
}

/**
 * Replies to a comment (or to the post) through Zernio and stores the reply in our own messages
 * collection. Shared by the manual reply callable and the agent's automatic mode.
 */
export async function sendReply(
  uid: string,
  postId: string,
  messageId: string | undefined,
  text: string,
  opts: SendOpts,
) {
  const { attachmentUrl, requestId, sentBy } = opts;
  const { postSnap, msgSnap, accountId, zernioPostRef } = await loadContext(uid, postId, messageId);
  const platform = msgSnap?.get("platform") ?? postSnap.get("platforms")?.[0]?.platform ?? null;
  // Zernio only accepts image attachments on Facebook comments.
  if (attachmentUrl && platform !== "facebook")
    throw new HttpsError("failed-precondition", "Los anexos solo se pueden enviar en Facebook");
  const key = await getTenantZernioKey(uid).catch((e: Error) => {
    throw new HttpsError("failed-precondition", e.message);
  });
  // DM first: if it fails the public reply ("te lo enviamos por mensaje privado") must not go out.
  const quote = await settleQuote(uid, key, msgSnap, { accountId, zernioPostRef, platform }, opts);
  const booking = await settleBooking(uid, msgSnap, opts);
  await settleClient(uid, msgSnap, opts);
  const res = await zernio<{ data?: { commentId?: string } }>(key, `/inbox/comments/${encodeURIComponent(zernioPostRef)}`, {
    method: "POST",
    idempotencyKey: requestId,
    body: {
      accountId,
      message: text.trim(),
      ...(msgSnap ? { commentId: msgSnap.get("commentId") } : {}),
      ...(attachmentUrl ? { attachmentUrl } : {}),
    },
  }).catch((e: Error) => {
    throw new HttpsError("internal", e.message);
  });

  const commentId = res.data?.commentId ?? `local_${Date.now()}`;
  const replyRef = db().collection(postMessagesCol(uid, postId)).doc(safeId(commentId));
  await db().runTransaction(async (tx) => {
    // The webhook may echo our reply back first; same doc id keeps it single.
    if ((await tx.get(replyRef)).exists) return;
    tx.set(replyRef, {
      kind: "comment",
      uid,
      postId,
      commentId,
      parentId: msgSnap?.get("commentId") ?? null,
      platform,
      accountId,
      zernioPostId: postSnap.get("zernioPostId") ?? null,
      platformPostId: msgSnap?.get("platformPostId") ?? null,
      author: { id: null, name: sentBy === "ai" ? "Agente IA" : "Tú", username: null, picture: null },
      text: text.trim(),
      attachmentUrl: attachmentUrl ?? null,
      direction: "out",
      sentBy,
      read: true,
      hidden: false,
      booking,
      quote,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.update(postSnap.ref, { commentCount: FieldValue.increment(1) });
    // Answered: any pending AI draft on that comment is no longer needed.
    if (msgSnap) tx.update(msgSnap.ref, { replied: true, aiDraft: null, ...(sentBy === "ai" ? { aiStatus: "sent" } : {}) });
  });
  return { id: replyRef.id, booking, quote };
}

/** Replies in a DM conversation through Zernio and stores the message. Same contract as sendReply. */
export async function sendDm(uid: string, convId: string, messageId: string | undefined, text: string, opts: SendOpts) {
  const convSnap = await db().collection(conversationsCol(uid)).doc(convId).get();
  if (!convSnap.exists) throw new HttpsError("not-found", "Conversación no encontrada");
  const msgsCol = db().collection(conversationMessagesCol(uid, convId));
  const msgSnap = messageId ? await msgsCol.doc(messageId).get() : null;
  if (messageId && !msgSnap?.exists) throw new HttpsError("not-found", "Mensaje no encontrado");
  const last = msgSnap ?? (await msgsCol.orderBy("createdAt", "desc").limit(20).get()).docs.find((d) => d.get("direction") === "in");
  const accountId = (convSnap.get("accountId") as string | null) ?? last?.get("accountId");
  const zernioConvId = (last?.get("conversationId") as string | undefined) ?? convId;
  if (!accountId) throw new HttpsError("failed-precondition", "Falta la cuenta de Zernio de la conversación");

  const key = await getTenantZernioKey(uid).catch((e: Error) => {
    throw new HttpsError("failed-precondition", e.message);
  });
  const booking = await settleBooking(uid, msgSnap, opts);
  await settleClient(uid, msgSnap, opts);
  const att = opts.attachment ?? null;
  const res = await zernio<{ data?: { messageId?: string } }>(key, `/inbox/conversations/${encodeURIComponent(zernioConvId)}/messages`, {
    method: "POST",
    idempotencyKey: opts.requestId,
    body: {
      accountId,
      ...(text.trim() ? { message: text.trim() } : {}),
      ...(att ? { attachmentUrl: att.url, attachmentType: att.type, attachmentName: att.name } : {}),
    },
  }).catch((e: Error) => {
    if (att && /PLATFORM_LIMITATION|not support/i.test(e.message))
      throw new HttpsError("failed-precondition", "Esta red no acepta archivos en mensajes directos: quita el adjunto y envía el link.");
    throw new HttpsError("internal", e.message);
  });

  const zid = res.data?.messageId ?? `local_${Date.now()}`;
  const ref = msgsCol.doc(safeId(zid));
  await db().runTransaction(async (tx) => {
    // The message.sent webhook may store it first; same doc id keeps it single.
    if (!(await tx.get(ref)).exists)
      tx.set(ref, {
        kind: "dm",
        uid,
        conversationId: zernioConvId,
        platform: convSnap.get("platform") ?? last?.get("platform") ?? null,
        accountId,
        author: { id: null, name: opts.sentBy === "ai" ? "Agente IA" : "Tú", username: null, picture: null },
        text: text.trim(),
        attachments: att ? [att] : [],
        direction: "out",
        sentBy: opts.sentBy,
        read: true,
        booking,
        createdAt: FieldValue.serverTimestamp(),
      });
    else tx.update(ref, { sentBy: opts.sentBy, booking });
    tx.set(convSnap.ref, { lastMessage: text.trim() || (att ? `📎 ${att.name}` : ""), lastMessageAt: FieldValue.serverTimestamp(), lastDirection: "out" }, { merge: true });
    if (msgSnap) tx.update(msgSnap.ref, { replied: true, aiDraft: null, ...(opts.sentBy === "ai" ? { aiStatus: "sent" } : {}) });
  });
  return { id: ref.id, booking };
}

// Files the app itself uploads: Zernio media or Firebase Storage. Zernio fetches them publicly.
const isAttachmentUrl = (raw: string) => {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && (u.host.endsWith("zernio.com") || u.host === "firebasestorage.googleapis.com");
  } catch {
    return false;
  }
};

export const kfReplyToDm = onCall({ secrets: [DF_AI_ENCRYPTION_KEY] }, async (req) => {
  const uid = await workspaceOf(req, "inbox.reply");
  const { conversationId, messageId, text, requestId, booking, saveClient, attachmentUrl, attachmentName, attachmentType } = req.data as {
    conversationId?: string;
    messageId?: string;
    text?: string;
    requestId?: string;
    booking?: BookingAction;
    saveClient?: boolean;
    attachmentUrl?: string;
    attachmentName?: string;
    attachmentType?: string;
  };
  if (attachmentUrl && !isAttachmentUrl(attachmentUrl)) throw new HttpsError("invalid-argument", "Anexo no válido");
  if (!conversationId || (!text?.trim() && !attachmentUrl)) throw new HttpsError("invalid-argument", "Faltan conversationId o text");
  const attachment: DmAttachment | null = attachmentUrl
    ? { url: attachmentUrl, name: String(attachmentName ?? "archivo").slice(0, 120), type: attachmentType === "image" ? "image" : "file" }
    : null;
  return sendDm(uid, conversationId, messageId, text ?? "", { requestId, sentBy: "user", booking, saveClient, attachment });
});

export const kfReplyToComment = onCall({ secrets: [DF_AI_ENCRYPTION_KEY] }, async (req) => {
  const uid = await workspaceOf(req, "inbox.reply");
  const { postId, messageId, text, requestId, attachmentUrl, booking, saveClient, quote } = req.data as {
    postId?: string;
    messageId?: string;
    text?: string;
    requestId?: string;
    attachmentUrl?: string;
    booking?: BookingAction;
    saveClient?: boolean;
    quote?: QuoteAction;
  };
  if (!postId || !text?.trim()) throw new HttpsError("invalid-argument", "Faltan postId o text");
  if (attachmentUrl && !/^https:\/\//.test(attachmentUrl)) throw new HttpsError("invalid-argument", "Anexo no válido");
  return sendReply(uid, postId, messageId, text, { attachmentUrl, requestId, sentBy: "user", booking, saveClient, quote: quote === "send" ? "send" : undefined });
});

export const kfHideComment = onCall({ secrets: [DF_AI_ENCRYPTION_KEY] }, async (req) => {
  const uid = await workspaceOf(req, "inbox.reply");
  const { postId, messageId, hidden = true } = req.data as { postId?: string; messageId?: string; hidden?: boolean };
  if (!postId || !messageId) throw new HttpsError("invalid-argument", "Faltan postId o messageId");

  const { msgSnap, accountId, zernioPostRef } = await loadContext(uid, postId, messageId);
  const path = `/inbox/comments/${encodeURIComponent(zernioPostRef)}/${encodeURIComponent(msgSnap!.get("commentId"))}/hide`;
  const key = await getTenantZernioKey(uid).catch((e: Error) => {
    throw new HttpsError("failed-precondition", e.message);
  });
  await zernio(key, path, { method: hidden ? "POST" : "DELETE", body: { accountId } }).catch((e: Error) => {
    throw new HttpsError("failed-precondition", e.message);
  });
  await msgSnap!.ref.update({ hidden });
  return { ok: true };
});
