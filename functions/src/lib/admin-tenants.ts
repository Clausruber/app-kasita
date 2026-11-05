
import crypto from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { HttpError } from "./auth-guard";
import { adminAuth, adminDb } from "./firebase/admin";
import { tenantDoc, tenantsCol, userDoc } from "./firebase/paths";
import { decrypt, encrypt } from "./ai-crypto";
import type { TenantStatus } from "./tenants";
import { ZernioError, zernioWithKey } from "./zernio";

export const WEBHOOK_EVENTS = [
  "comment.received",
  "message.received",
  "message.sent",
  "post.published",
  "post.failed",
  "post.partial",
  "account.disconnected",
];

function webhookBaseUrl() {
  const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  return process.env.DF_WEBHOOK_URL || `https://us-central1-${project}.cloudfunctions.net/kfZernioWebhook`;
}

export type TenantRow = {
  uid: string;
  email: string | null;
  name: string | null;
  createdAt: string | null;
  lastSignIn: string | null;
  role: "superadmin" | "admin";
  status: TenantStatus;
  zernioKeyHint: string | null;
  companyName: string | null;
  whatsapp: string | null;
  webhookId: string | null;
  activatedAt: string | null;
};

/**
 * Accounts registered in this app (have a tenant record) plus SuperAdmins, joined with Auth data.
 * Auth is shared with another app: users that never signed in here are not listed.
 */
export async function listTenants(): Promise<TenantRow[]> {
  const users = [];
  let page: string | undefined;
  do {
    const res = await adminAuth.listUsers(1000, page);
    users.push(...res.users);
    page = res.pageToken;
  } while (page && users.length < 5000);

  const tenants = new Map((await adminDb.collection(tenantsCol()).get()).docs.map((d) => [d.id, d]));
  return users
    .filter((u) => tenants.has(u.uid) || u.customClaims?.dfRole === "superadmin")
    .map((u) => {
      const t = tenants.get(u.uid);
      const at = t?.get("activatedAt") as FirebaseFirestore.Timestamp | undefined;
      return {
        uid: u.uid,
        email: u.email ?? null,
        name: u.displayName ?? null,
        createdAt: u.metadata.creationTime ? new Date(u.metadata.creationTime).toISOString() : null,
        lastSignIn: u.metadata.lastSignInTime ? new Date(u.metadata.lastSignInTime).toISOString() : null,
        role: u.customClaims?.dfRole === "superadmin" ? ("superadmin" as const) : ("admin" as const),
        status: (t?.get("status") as TenantStatus | undefined) ?? "pending",
        zernioKeyHint: (t?.get("zernioKeyHint") as string | undefined) ?? null,
        companyName: (t?.get("companyName") as string | undefined) ?? null,
        whatsapp: (t?.get("whatsapp") as string | undefined) ?? null,
        webhookId: (t?.get("webhookId") as string | undefined) ?? null,
        activatedAt: at ? at.toDate().toISOString() : null,
      };
    })
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

/** Validates a Zernio key with a read-only call. */
async function assertZernioKey(key: string) {
  try {
    await zernioWithKey(key, "/profiles");
  } catch (e) {
    if (e instanceof ZernioError && (e.status === 401 || e.status === 403)) throw new HttpError(400, "Zernio rechazó la API key");
    throw e;
  }
}

/**
 * Sets an account's Zernio key: validates it, registers a webhook for that Zernio account pointing to
 * kfZernioWebhook?tenant=<uid> with its own secret, and removes the previous webhook if the key changed.
 */
export async function setTenantZernioKey(uid: string, key: string, actor: string) {
  if (!/^sk_[A-Za-z0-9]{16,}$/.test(key)) throw new HttpError(400, "La API key de Zernio debe empezar por sk_");
  await assertZernioKey(key);

  const ref = adminDb.doc(tenantDoc(uid));
  const prev = await ref.get();
  const prevKey = prev.get("zernioKey") ? decrypt(prev.get("zernioKey")) : null;
  const user = await adminAuth.getUser(uid);

  // New webhook for this key.
  const secret = crypto.randomBytes(32).toString("hex");
  const { webhook } = await zernioWithKey<{ webhook: { _id: string } }>(key, "/webhooks/settings", {
    method: "POST",
    body: {
      name: `Social Planner · ${user.email ?? uid}`.slice(0, 100),
      url: `${webhookBaseUrl()}?tenant=${encodeURIComponent(uid)}`,
      secret,
      events: WEBHOOK_EVENTS,
    },
  });

  // Old webhook: best effort (the old key may already be revoked).
  const prevWebhook = prev.get("webhookId") as string | undefined;
  if (prevKey && prevWebhook) {
    await zernioWithKey(prevKey, "/webhooks/settings", { method: "DELETE", query: { webhookId: prevWebhook } }).catch(() => {});
  }

  await ref.set(
    {
      zernioKey: encrypt(key),
      zernioKeyHint: `…${key.slice(-4)}`,
      webhookId: webhook._id,
      webhookSecret: encrypt(secret),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor,
    },
    { merge: true },
  );

  // A different key is a different Zernio account: the old profile does not exist there.
  if (prevKey && prevKey !== key) {
    await adminDb.doc(userDoc(uid)).set({ zernioProfileId: FieldValue.delete() }, { merge: true });
  }
}

export async function setTenantStatus(uid: string, status: TenantStatus, actor: string) {
  // An account can be activated without a Zernio key: the app works (agenda, clients, team…) and the
  // social-network features start once the SuperAdmin assigns the key.
  const ref = adminDb.doc(tenantDoc(uid));
  await ref.set(
    {
      status,
      ...(status === "active" ? { activatedAt: FieldValue.serverTimestamp() } : {}),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor,
    },
    { merge: true },
  );
}
