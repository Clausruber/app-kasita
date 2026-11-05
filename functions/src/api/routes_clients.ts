import { Router, Response } from "express";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { authRequired, AuthenticatedRequest } from "../api_middleware";
import { MESSAGES, clientDoc, clientsCol, bookingsCol } from "../paths";
import { authorKeyOf, clientIdOf, parseClientEdit, toClientRow } from "../lib/clients";

export const clientsRouter = Router();

clientsRouter.get("/", authRequired({ perm: "clients" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const db = getFirestore();
    const snap = await db.collection(clientsCol(user.uid)).orderBy("lastContactAt", "desc").limit(2000).get();
    return res.json({ clients: snap.docs.map((d) => toClientRow(d.id, d.data())) });
  } catch (err: any) {
    console.error("GET /clients error:", err);
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

clientsRouter.post("/import", authRequired({ perm: "clients" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const db = getFirestore();
    const snap = await db
      .collectionGroup(MESSAGES)
      .where("uid", "==", user.uid)
      .where("kind", "in", ["comment", "dm"])
      .orderBy("createdAt", "desc")
      .limit(10000)
      .get();

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

    const map = new Map<string, Agg>();
    for (const d of snap.docs) {
      const m = d.data();
      const key = authorKeyOf(m.author);
      if (m.direction !== "in" || !key || !m.platform || !(m.createdAt instanceof Timestamp)) continue;
      const id = clientIdOf(m.platform, key);
      const a = map.get(id);
      if (!a) {
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

    const writer = db.bulkWriter();
    for (const [id, a] of map) {
      void writer.set(
        db.doc(clientDoc(user.uid, id)),
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
    return res.json({ imported: map.size });
  } catch (err: any) {
    console.error("POST /clients/import error:", err);
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

clientsRouter.get("/:id", authRequired({ perm: "clients" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const id = req.params.id as string;
    const db = getFirestore();
    const snap = await db.doc(clientDoc(user.uid, id)).get();
    if (!snap.exists) return res.status(404).json({ error: "Cliente no encontrado" });
    const client = toClientRow(snap.id, snap.data()!);
    const bookings = (await db.collection(bookingsCol(user.uid)).where("customer.authorId", "==", client.authorId).get()).docs
      .filter((b) => !b.get("customer.platform") || b.get("customer.platform") === client.platform)
      .map((b) => ({
        id: b.id,
        service: b.get("service") as string,
        start: (b.get("start") as Timestamp).toDate().toISOString(),
        timezone: b.get("timezone") as string,
        status: b.get("status") as string,
      }))
      .sort((a, b) => b.start.localeCompare(a.start));
    return res.json({ client, bookings });
  } catch (err: any) {
    console.error("GET /clients/:id error:", err);
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

clientsRouter.put("/:id", authRequired({ perm: "clients.edit" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const id = req.params.id as string;
    const db = getFirestore();
    const ref = db.doc(clientDoc(user.uid, id));
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Cliente no encontrado" });
    const data = parseClientEdit(req.body);
    const reviewed = Object.keys(snap.get("aiEdited") ?? {}).filter((k) => k in data && data[k as keyof typeof data] !== (snap.get(k) ?? ""));
    await ref.update({
      ...data,
      ...Object.fromEntries(reviewed.map((k) => [`aiEdited.${k}`, FieldValue.delete()])),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return res.json({ client: toClientRow(id, (await ref.get()).data()!) });
  } catch (err: any) {
    console.error("PUT /clients/:id error:", err);
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

