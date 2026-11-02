import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { withPerm } from "@/lib/auth-guard";
import { adminDb } from "@/lib/firebase/admin";
import { MESSAGES, clientDoc } from "@/lib/firebase/paths";
import { authorKeyOf, clientIdOf } from "@/lib/clients";

type Agg = {
  platform: string;
  key: string;
  author: { name?: string; username?: string | null; picture?: string | null };
  count: number;
  channels: Set<string>;
  first: Timestamp;
  last: Timestamp;
  lastMessage: string;
  lastChannel: { kind: string; postId: string | null; conversationId: string | null };
};

/**
 * Builds the client list from comments and DMs received before the Clientes page existed.
 * Idempotent: counts and dates are recomputed, fields edited by the owner are left alone.
 */
export const POST = withPerm("clients", async (_req, user) => {
  const snap = await adminDb
    .collectionGroup(MESSAGES)
    .where("uid", "==", user.uid)
    .where("kind", "in", ["comment", "dm"])
    .orderBy("createdAt", "desc")
    .limit(10000)
    .get();

  const map = new Map<string, Agg>();
  for (const d of snap.docs) {
    const m = d.data();
    const key = authorKeyOf(m.author);
    if (m.direction !== "in" || !key || !m.platform || !(m.createdAt instanceof Timestamp)) continue;
    const id = clientIdOf(m.platform, key);
    const a = map.get(id);
    if (!a) {
      // Newest first: the first message seen is the latest contact.
      map.set(id, {
        platform: m.platform,
        key,
        author: { ...m.author },
        count: 1,
        channels: new Set([m.kind]),
        first: m.createdAt,
        last: m.createdAt,
        lastMessage: String(m.text ?? "").slice(0, 300),
        lastChannel: { kind: m.kind, postId: m.postId ?? null, conversationId: m.kind === "dm" ? d.ref.parent.parent!.id : null },
      });
      continue;
    }
    a.count++;
    a.channels.add(m.kind);
    a.first = m.createdAt;
    a.author.picture ||= m.author?.picture;
  }

  const writer = adminDb.bulkWriter();
  for (const [id, a] of map) {
    void writer.set(
      adminDb.doc(clientDoc(user.uid, id)),
      {
        uid: user.uid,
        platform: a.platform,
        authorId: a.key,
        displayName: a.author.name || a.author.username || "",
        username: a.author.username ?? null,
        picture: a.author.picture ?? null,
        messageCount: a.count,
        channels: [...a.channels],
        firstContactAt: a.first,
        lastContactAt: a.last,
        lastMessage: a.lastMessage,
        lastChannel: a.lastChannel,
        importedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }
  await writer.close();
  return NextResponse.json({ imported: map.size });
});
