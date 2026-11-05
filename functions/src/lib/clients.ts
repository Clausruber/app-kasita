
import { Timestamp } from "firebase-admin/firestore";
import { HttpError } from "./auth-guard";

// Keep in sync with functions/src/clients.ts.
export const authorKeyOf = (a?: { id?: string | null; name?: string | null; username?: string | null }) => a?.id || a?.username || a?.name || null;
export const clientIdOf = (platform: string, authorKey: string) => `${platform}_${authorKey}`.replace(/[/.#$[\]]/g, "_").slice(0, 400);

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export type ClientRow = {
  id: string;
  platform: string;
  authorId: string;
  displayName: string;
  username: string | null;
  picture: string | null;
  firstName: string;
  lastName: string;
  whatsapp: string;
  email: string;
  notes: string;
  extra: { label: string; value: string }[];
  aiEdited: Record<string, string>;
  messageCount: number;
  channels: string[];
  lastMessage: string;
  firstContactAt: string | null;
  lastContactAt: string | null;
};

const iso = (v: unknown) => (v instanceof Timestamp ? v.toDate().toISOString() : null);

export function toClientRow(id: string, d: FirebaseFirestore.DocumentData): ClientRow {
  return {
    id,
    platform: d.platform ?? "",
    authorId: d.authorId ?? "",
    displayName: d.displayName ?? "",
    username: d.username ?? null,
    picture: d.picture ?? null,
    firstName: d.firstName ?? "",
    lastName: d.lastName ?? "",
    whatsapp: d.whatsapp ?? "",
    email: d.email ?? "",
    notes: d.notes ?? "",
    extra: Array.isArray(d.extra) ? d.extra : [],
    aiEdited: Object.fromEntries(Object.entries((d.aiEdited ?? {}) as Record<string, unknown>).map(([k, v]) => [k, iso(v)]).filter(([, v]) => v)),
    messageCount: d.messageCount ?? 0,
    channels: d.channels ?? [],
    lastMessage: d.lastMessage ?? "",
    firstContactAt: iso(d.firstContactAt),
    lastContactAt: iso(d.lastContactAt),
  };
}

/** Validates the fields the owner edits. Social data (name on the network, picture…) is not editable. */
export function parseClientEdit(body: Record<string, unknown>) {
  const whatsapp = clip(body.whatsapp, 30).replace(/[\s().-]/g, "");
  if (whatsapp && !/^\+?\d{6,15}$/.test(whatsapp))
    throw new HttpError(400, "WhatsApp no válido: usa el número con prefijo de país, p. ej. +5511987654321");
  const email = clip(body.email, 200);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Email no válido");
  const extra = (Array.isArray(body.extra) ? body.extra : [])
    .map((x: { label?: unknown; value?: unknown }) => ({ label: clip(x?.label, 60), value: clip(x?.value, 500) }))
    .filter((x) => x.label || x.value)
    .slice(0, 20);
  if (extra.some((x) => !x.label)) throw new HttpError(400, "Cada dato extra necesita un nombre");
  return {
    firstName: clip(body.firstName, 80),
    lastName: clip(body.lastName, 120),
    whatsapp: whatsapp && !whatsapp.startsWith("+") ? `+${whatsapp}` : whatsapp,
    email,
    notes: clip(body.notes, 2000),
    extra,
  };
}
