import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { clientDoc, clientsCol } from "./paths";

const db = () => getFirestore();

type Author = { id?: string | null; name?: string | null; username?: string | null; picture?: string | null };

/** Stable key of a social user, the same one bookings store as customer.authorId. */
export const authorKeyOf = (a: Author | undefined) => a?.id || a?.username || a?.name || null;

/** One client per platform user. Ids are Firestore-safe. */
export const clientIdOf = (platform: string, authorKey: string) => `${platform}_${authorKey}`.replace(/[/.#$[\]]/g, "_").slice(0, 400);

/**
 * Registers (or refreshes) the contact behind an incoming comment/DM. Social fields are refreshed;
 * the fields the owner edits on the Clientes page (firstName, lastName, whatsapp, …) are never touched.
 */
export async function touchClient(
  uid: string,
  m: { platform: string; author: Author; text: string; at: Date; channel: "comment" | "dm"; postId?: string; conversationId?: string },
) {
  const key = authorKeyOf(m.author);
  if (!key || !m.platform) return;
  const ref = db().doc(clientDoc(uid, clientIdOf(m.platform, key)));
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const at = Timestamp.fromDate(m.at);
    const prevLast = snap.get("lastContactAt") as Timestamp | undefined;
    tx.set(
      ref,
      {
        uid,
        platform: m.platform,
        authorId: key,
        displayName: m.author.name || m.author.username || "",
        username: m.author.username ?? null,
        ...(m.author.picture ? { picture: m.author.picture } : {}),
        messageCount: FieldValue.increment(1),
        channels: FieldValue.arrayUnion(m.channel),
        ...(!prevLast || prevLast.toMillis() <= at.toMillis()
          ? { lastContactAt: at, lastMessage: m.text.slice(0, 300), lastChannel: { kind: m.channel, postId: m.postId ?? null, conversationId: m.conversationId ?? null } }
          : {}),
        ...(snap.exists ? {} : { firstContactAt: at, createdAt: FieldValue.serverTimestamp() }),
      },
      { merge: true },
    );
  });
}

export const CLIENT_FIELDS = ["firstName", "lastName", "whatsapp", "email"] as const;
export type ClientField = (typeof CLIENT_FIELDS)[number];
export type ClientFields = Partial<Record<ClientField, string>>;
// Data the agent collected in a conversation; saved when the reply is sent (auto: at once).
export type ClientProposal = { platform: string; authorId: string; author: Author; fields: ClientFields };

export type ClientProfile = { firstName: string | null; lastName: string | null; fullName: string | null; whatsapp: string | null; email: string | null; notes: string | null };

/** Owner-edited client data, for the agent's context (null when the client is unknown). */
export async function getClientProfile(uid: string, platform: string, authorKey: string): Promise<ClientProfile | null> {
  const s = await db().doc(clientDoc(uid, clientIdOf(platform, authorKey))).get();
  if (!s.exists) return null;
  const str = (k: string) => ((s.get(k) as string | undefined) || "").trim() || null;
  const fullName = [str("firstName"), str("lastName")].filter(Boolean).join(" ") || null;
  return { firstName: str("firstName"), lastName: str("lastName"), fullName, whatsapp: str("whatsapp"), email: str("email"), notes: str("notes") };
}

/** Same rules as the Clientes page (web/src/lib/clients.ts). Returns the normalised value or an error. */
export function normaliseField(field: ClientField, raw: string): { value: string } | { error: string } {
  const v = raw.trim();
  if (!v) return { error: `${field} vacío` };
  if (field === "whatsapp") {
    const digits = v.replace(/[\s().-]/g, "");
    if (!/^\+?\d{6,15}$/.test(digits)) return { error: "número de WhatsApp no válido: pide el número completo con prefijo de país" };
    return { value: digits.startsWith("+") ? digits : `+${digits}` };
  }
  if (field === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? { value: v.slice(0, 200) } : { error: "email no válido" };
  return { value: v.slice(0, field === "firstName" ? 80 : 120) };
}

/**
 * Decides which fields the agent may write: empty ones always; ones that already have a value only
 * when the person explicitly corrects them. What the owner typed is never overwritten silently.
 */
export function mergeClientFields(current: ClientProfile | null, incoming: ClientFields, correction: boolean) {
  const accepted: ClientFields = {};
  const kept: Partial<Record<ClientField, string>> = {};
  for (const f of CLIENT_FIELDS) {
    const v = incoming[f];
    if (!v) continue;
    const prev = current?.[f] ?? null;
    if (!prev || prev === v || correction) accepted[f] = v;
    else kept[f] = prev;
  }
  return { accepted, kept };
}

/** Writes the agent's proposal to the client card (creating it if needed) and marks those fields as AI-edited. */
export async function applyClientProposal(uid: string, p: ClientProposal) {
  const fields = Object.fromEntries(Object.entries(p.fields).filter(([, v]) => v)) as ClientFields;
  if (!Object.keys(fields).length) return null;
  const ref = db().doc(clientDoc(uid, clientIdOf(p.platform, p.authorId)));
  const now = Timestamp.now();
  await ref.set(
    {
      uid,
      platform: p.platform,
      authorId: p.authorId,
      ...(p.author.name || p.author.username ? { displayName: p.author.name || p.author.username } : {}),
      ...fields,
      aiEdited: Object.fromEntries(Object.keys(fields).map((k) => [k, now])),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return fields;
}

export type BookingClientInput = { clientId?: string; firstName?: string; lastName?: string; whatsapp?: string };

/**
 * Finds the client of a booking made from the Agendar modal: the given clientId, else the client with
 * that WhatsApp (any network), else a new "manual" client. Writes nothing (see saveBookingClient).
 */
export async function findBookingClient(uid: string, input: BookingClientInput) {
  const firstName = input.firstName?.trim().slice(0, 80) ?? "";
  const lastName = input.lastName?.trim().slice(0, 120) ?? "";
  let whatsapp: string | null = null;
  if (input.whatsapp?.trim()) {
    const r = normaliseField("whatsapp", input.whatsapp);
    if ("error" in r) throw new Error("WhatsApp no válido: usa el número con prefijo de país, p. ej. +5511987654321");
    whatsapp = r.value;
  }
  let snap: FirebaseFirestore.DocumentSnapshot | null = null;
  if (input.clientId) {
    snap = await db().collection(clientsCol(uid)).doc(input.clientId).get();
    if (!snap.exists) throw new Error("Cliente no encontrado");
  } else if (whatsapp) {
    snap = (await db().collection(clientsCol(uid)).where("whatsapp", "==", whatsapp).limit(1).get()).docs[0] ?? null;
  }
  if (!snap && !whatsapp) throw new Error("Indica el WhatsApp del cliente");
  const ref = snap?.ref ?? db().collection(clientsCol(uid)).doc(clientIdOf("manual", whatsapp!.slice(1)));
  const current = snap?.data() ?? {};
  const name = [firstName || current.firstName, lastName || current.lastName].filter(Boolean).join(" ") || current.displayName || "";
  return {
    ref,
    created: !snap,
    platform: (current.platform as string) ?? "manual",
    authorId: (current.authorId as string) ?? whatsapp!.slice(1),
    name,
    whatsapp: whatsapp ?? (current.whatsapp as string | undefined) ?? null,
    // Fill only what is empty: never overwrite data already on the card.
    fill: Object.fromEntries(
      Object.entries({ firstName, lastName, whatsapp }).filter(([k, v]) => v && !current[k]),
    ) as ClientFields,
  };
}

/** Creates the manual client or fills its empty fields, and records the contact. */
export async function saveBookingClient(uid: string, c: Awaited<ReturnType<typeof findBookingClient>>, label: string) {
  const now = Timestamp.now();
  await c.ref.set(
    {
      ...c.fill,
      ...(c.created
        ? { uid, platform: "manual", authorId: c.authorId, displayName: c.name, username: null, messageCount: 0, firstContactAt: now, createdAt: FieldValue.serverTimestamp() }
        : {}),
      channels: FieldValue.arrayUnion("admin"),
      lastContactAt: now,
      lastMessage: `Cita agendada: ${label}`.slice(0, 300),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}
