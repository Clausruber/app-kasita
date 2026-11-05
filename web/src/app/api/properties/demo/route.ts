import { randomUUID } from "crypto";
import { readFile } from "fs/promises";
import { join } from "path";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { HttpError, withPerm } from "@/lib/auth-guard";
import { adminBucket, adminDb } from "@/lib/firebase/admin";
import { dealsCol, salesCol, tasksCol, propertyDoc, propertiesCol } from "@/lib/firebase/paths";
import { DEMO_COUNT, DEMO_PHOTO_SIZE, demoPhotos, demoProperty } from "@/lib/demo-inventory";
import { parsePropertyInput } from "@/lib/properties";
import type { PropertyPhoto } from "@/lib/types";

const BATCH = 400;

/** Commits deletes in chunks under Firestore's 500-writes-per-batch limit. */
async function deleteAll(refs: FirebaseFirestore.DocumentReference[]) {
  for (let i = 0; i < refs.length; i += BATCH) {
    const batch = adminDb.batch();
    refs.slice(i, i + BATCH).forEach((r) => batch.delete(r));
    await batch.commit();
  }
}

/** Runs `fn` over `items` with at most `limit` in flight. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/** A demo photo's bytes: from disk when the public folder ships with the server, else from our own origin. */
async function readDemoPhoto(name: string, origin: string) {
  try {
    return await readFile(join(process.cwd(), "public", "demo-photos", `${name}.jpg`));
  } catch {
    const res = await fetch(`${origin}/demo-photos/${name}.jpg`);
    if (!res.ok) throw new Error(`demo photo ${name}: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
}

/**
 * Gives every demo property its stock photos, stored like the ones an agent uploads: each one is a file
 * under the property's Storage folder with a download token, so watermarking, posts, quotes and the
 * per-photo delete all work unchanged. Each photo is uploaded once to a staging folder and then copied
 * server-side to every property that uses it.
 */
async function attachDemoPhotos(uid: string, ids: string[], origin: string) {
  const bucket = adminBucket();
  const staging = `${propertyDoc(uid, "_demo-staging")}/`;
  const plan = ids.map((id, i) => ({ id, names: demoPhotos(i) }));
  const names = [...new Set(plan.flatMap((p) => p.names))];
  const sizes = new Map<string, number>(); // a copy's metadata does not report its size
  try {
    await pool(names, 6, async (name) => {
      const data = await readDemoPhoto(name, origin);
      sizes.set(name, data.length);
      await bucket.file(`${staging}${name}.jpg`).save(data, { contentType: "image/jpeg", resumable: false });
    });
    const copies = plan.flatMap((p) => p.names.map((name) => ({ id: p.id, name })));
    const done = await pool(copies, 8, async ({ id, name }) => {
      const token = randomUUID();
      const path = `${propertyDoc(uid, id)}/${randomUUID()}.jpg`;
      await bucket.file(`${staging}${name}.jpg`).copy(path, {
        contentType: "image/jpeg",
        cacheControl: "public,max-age=31536000",
        metadata: { firebaseStorageDownloadTokens: token },
      });
      const [w, h] = DEMO_PHOTO_SIZE[name] ?? [0, 0];
      const photo: PropertyPhoto = {
        path,
        url: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`,
        w,
        h,
        size: sizes.get(name) ?? 0,
      };
      return { id, photo };
    });
    const batch = adminDb.batch();
    for (const p of plan) batch.update(adminDb.doc(propertyDoc(uid, p.id)), { photos: done.filter((d) => d.id === p.id).map((d) => d.photo) });
    await batch.commit();
    return true;
  } catch (e) {
    console.warn("demo photos", e);
    return false;
  } finally {
    await bucket.deleteFiles({ prefix: staging }).catch(() => {});
  }
}

/** Loads the test properties (marked `demo: true`) with their photos. Only once: delete them before loading again. */
export const POST = withPerm("inventory.edit", async (req, user) => {
  const col = adminDb.collection(propertiesCol(user.uid));
  if (!(await col.where("demo", "==", true).limit(1).get()).empty)
    throw new HttpError(409, "Los datos de prueba ya están cargados. Bórralos antes de volver a cargarlos.");
  const batch = adminDb.batch();
  const ids: string[] = [];
  for (let i = 0; i < DEMO_COUNT; i++) {
    const ref = col.doc();
    ids.push(ref.id);
    batch.set(ref, {
      ...parsePropertyInput(demoProperty(i), true),
      demo: true,
      photos: [],
      reservation: null,
      lease: null,
      closedAt: null,
      createdBy: user.actor.authUid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  // Without Storage (not enabled in the project) the properties still load, just without photos.
  const photos = await attachDemoPhotos(user.uid, ids, new URL(req.url).origin);
  return NextResponse.json({ created: DEMO_COUNT, photos });
});

/** Deletes every test property, whatever its status, plus the deals, sales and follow-ups that point to them. */
export const DELETE = withPerm("inventory.delete", async (_req, user) => {
  const demo = await adminDb.collection(propertiesCol(user.uid)).where("demo", "==", true).get();
  const ids = new Set(demo.docs.map((d) => d.id));
  if (!ids.size) return NextResponse.json({ properties: 0, deals: 0, sales: 0, tasks: 0 });

  // Single-field queries only (no composite indexes in the shared project): filter in memory.
  const [deals, sales, tasks] = await Promise.all([
    adminDb.collection(dealsCol(user.uid)).get(),
    adminDb.collection(salesCol(user.uid)).get(),
    adminDb.collection(tasksCol(user.uid)).get(),
  ]);
  const demoDeals = deals.docs.filter((d) => ids.has(d.get("propertyId")));
  const dealIds = new Set(demoDeals.map((d) => d.id));
  const demoSales = sales.docs.filter((d) => ids.has(d.get("propertyId")));
  const demoTasks = tasks.docs.filter((d) => ids.has(d.get("propertyId")) || dealIds.has(d.get("dealId")));

  await deleteAll([...demoTasks, ...demoSales, ...demoDeals, ...demo.docs].map((d) => d.ref));
  // Photos uploaded to test properties while trying the system.
  await Promise.all(
    [...ids].map((id) => adminBucket().deleteFiles({ prefix: `${propertyDoc(user.uid, id)}/` }).catch((e) => console.warn("demo photos cleanup", e))),
  );
  return NextResponse.json({ properties: ids.size, deals: demoDeals.length, sales: demoSales.length, tasks: demoTasks.length });
});
