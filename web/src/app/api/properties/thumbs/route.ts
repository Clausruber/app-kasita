import { NextResponse } from "next/server";
import { withPerm } from "@/lib/auth-guard";
import { adminDb } from "@/lib/firebase/admin";
import { propertiesCol } from "@/lib/firebase/paths";
import { thumbForStoredPhoto } from "@/lib/property-thumbs";
import type { PropertyPhoto } from "@/lib/types";

// Photos uploaded before thumbnails existed: the Propiedades page calls this in the background until
// `remaining` is 0. Covers go first (they are what the lists show). A few per call keeps each
// request short on the small server.
const PER_CALL = 8;
const CONCURRENCY = 3;

export const POST = withPerm("inventory", async (_req, user) => {
  const snap = await adminDb.collection(propertiesCol(user.uid)).get();
  const missing = snap.docs
    .flatMap((d) => ((d.get("photos") ?? []) as PropertyPhoto[]).map((p, i) => ({ ref: d.ref, path: p.path, cover: i === 0, has: !!p.thumb })))
    .filter((x) => !x.has && x.path)
    .sort((a, b) => Number(b.cover) - Number(a.cover));
  const batch = missing.slice(0, PER_CALL);

  let failed = 0;
  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    await Promise.all(
      batch.slice(i, i + CONCURRENCY).map(async ({ ref, path }) => {
        try {
          const t = await thumbForStoredPhoto(path);
          // Only this photo's entry changes; reorders or deletes made meanwhile are kept.
          await adminDb.runTransaction(async (tx) => {
            const s = await tx.get(ref);
            const photos = ((s.get("photos") ?? []) as PropertyPhoto[]).map((p) => (p.path === path ? { ...p, ...t } : p));
            tx.update(ref, { photos });
          });
        } catch (e) {
          failed++;
          console.warn("thumb backfill", path, e);
        }
      }),
    );
  }
  // Failures are not retried in this round (the client stops when nothing advanced).
  return NextResponse.json({ done: batch.length - failed, failed, remaining: missing.length - (batch.length - failed) });
});
