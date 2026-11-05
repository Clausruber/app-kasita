import { defineSecret } from "firebase-functions/params";
import { getFirestore } from "firebase-admin/firestore";
import { tenantDoc } from "./paths";
import { decrypt } from "./crypto";

// Legacy: secret of the webhook registered before per-account keys (URL without ?tenant=).
export const ZERNIO_WEBHOOK_SECRET = defineSecret("DF_ZERNIO_WEBHOOK_SECRET");

const BASE_URL = process.env.ZERNIO_API_URL || "https://zernio.com/api/v1";

/** The account's own Zernio key, set by the SuperAdmin. Needs DF_AI_ENCRYPTION_KEY bound. */
export async function getTenantZernioKey(uid: string): Promise<string> {
  const snap = await getFirestore().doc(tenantDoc(uid)).get();
  const enc = snap.get("zernioKey") as string | undefined;
  if (snap.get("status") !== "active") throw new Error("La cuenta no está activa");
  if (!enc) throw new Error("La conexión con las redes sociales aún no está configurada (falta la API key de Zernio)");
  return decrypt(enc);
}

/** The per-account webhook secret, or null when the account has none (legacy webhook). */
export async function getTenantWebhookSecret(uid: string): Promise<string | null> {
  const snap = await getFirestore().doc(tenantDoc(uid)).get();
  const enc = snap.get("webhookSecret") as string | undefined;
  return enc ? decrypt(enc) : null;
}

export async function zernio<T = unknown>(
  key: string,
  path: string,
  init: { method?: string; body?: unknown; idempotencyKey?: string } = {},
): Promise<T> {
  const res = await fetch(BASE_URL + path, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.idempotencyKey ? { "Idempotency-Key": init.idempotencyKey } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = data && typeof data === "object" && "error" in data ? String(data.error) : `Zernio ${res.status}`;
    throw new ZernioError(msg, res.status, data && typeof data === "object" ? (data.details ?? null) : null);
  }
  return data as T;
}

/** Zernio API error, with the HTTP status and the `details` object some endpoints add (e.g. private replies). */
export class ZernioError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: Record<string, unknown> | null,
  ) {
    super(message);
  }
}
