import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { userDoc, zernioAccountIndex, zernioProfileIndex } from "@/lib/firebase/paths";
import { getTenantZernioKey } from "@/lib/tenants";

const BASE_URL = process.env.ZERNIO_API_URL || "https://zernio.com/api/v1";

export class ZernioError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(
      typeof body === "object" && body && "error" in body
        ? String((body as { error: unknown }).error)
        : `Zernio API error ${status}`,
    );
  }
}

type ZernioInit = { method?: string; body?: unknown; query?: Record<string, string | undefined>; idempotencyKey?: string };

/** Calls Zernio with the account's own API key (set by the SuperAdmin). */
export async function zernio<T = unknown>(uid: string, path: string, init: ZernioInit = {}): Promise<T> {
  return zernioWithKey<T>(await getTenantZernioKey(uid), path, init);
}

export async function zernioWithKey<T = unknown>(key: string, path: string, init: ZernioInit = {}): Promise<T> {

  const url = new URL(BASE_URL + path);
  for (const [k, v] of Object.entries(init.query ?? {})) if (v !== undefined) url.searchParams.set(k, v);

  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(init.idempotencyKey ? { "Idempotency-Key": init.idempotencyKey } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ZernioError(res.status, data);
  return data as T;
}

export type ZernioAccount = {
  _id: string;
  platform: string;
  username?: string;
  displayName?: string;
  profilePicture?: string;
  isActive?: boolean;
  profileId?: string | { _id: string };
};

/** Returns the user's Zernio profile id, creating the profile (and indexes) on first use. */
export async function getProfileForUser(uid: string, email?: string | null): Promise<string> {
  const ref = adminDb.doc(userDoc(uid));
  const snap = await ref.get();
  const existing = snap.get("zernioProfileId") as string | undefined;
  if (existing) return existing;

  const { profile } = await zernio<{ profile: { _id: string } }>(uid, "/profiles", {
    method: "POST",
    body: { name: email || uid, externalId: uid },
  });

  const batch = adminDb.batch();
  batch.set(
    ref,
    { email: email ?? null, zernioProfileId: profile._id, createdAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  batch.set(adminDb.doc(zernioProfileIndex(profile._id)), { uid });
  await batch.commit();
  return profile._id;
}

/** Indexes accounts → uid so webhooks that only carry an accountId can be routed. */
export async function indexAccounts(uid: string, accounts: ZernioAccount[]) {
  if (!accounts.length) return;
  const batch = adminDb.batch();
  for (const a of accounts) batch.set(adminDb.doc(zernioAccountIndex(a._id)), { uid, platform: a.platform });
  await batch.commit();
}
