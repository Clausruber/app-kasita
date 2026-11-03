import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { HttpError, withPerm } from "@/lib/auth-guard";
import { adminBucket, adminDb } from "@/lib/firebase/admin";
import { dealsCol, salesCol, tasksCol, vehicleDoc, vehiclesCol } from "@/lib/firebase/paths";
import { DEMO_COUNT, demoVehicle } from "@/lib/demo-inventory";
import { parseVehicleInput } from "@/lib/vehicles";

const BATCH = 400;

/** Commits deletes in chunks under Firestore's 500-writes-per-batch limit. */
async function deleteAll(refs: FirebaseFirestore.DocumentReference[]) {
  for (let i = 0; i < refs.length; i += BATCH) {
    const batch = adminDb.batch();
    refs.slice(i, i + BATCH).forEach((r) => batch.delete(r));
    await batch.commit();
  }
}

/** Loads 50 test cars (marked `demo: true`). Only once: delete them before loading again. */
export const POST = withPerm("inventory.edit", async (_req, user) => {
  const col = adminDb.collection(vehiclesCol(user.uid));
  if (!(await col.where("demo", "==", true).limit(1).get()).empty)
    throw new HttpError(409, "Los datos de prueba ya están cargados. Bórralos antes de volver a cargarlos.");
  const batch = adminDb.batch();
  for (let i = 0; i < DEMO_COUNT; i++) {
    batch.set(col.doc(), {
      ...parseVehicleInput(demoVehicle(i), false),
      demo: true,
      photos: [],
      reservation: null,
      soldAt: null,
      mlPermalink: null,
      createdBy: user.actor.authUid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  return NextResponse.json({ created: DEMO_COUNT });
});

/** Deletes every test car, whatever its status, plus the deals, sales and follow-ups that point to them. */
export const DELETE = withPerm("inventory.delete", async (_req, user) => {
  const demo = await adminDb.collection(vehiclesCol(user.uid)).where("demo", "==", true).get();
  const ids = new Set(demo.docs.map((d) => d.id));
  if (!ids.size) return NextResponse.json({ vehicles: 0, deals: 0, sales: 0, tasks: 0 });

  // Single-field queries only (no composite indexes in the shared project): filter in memory.
  const [deals, sales, tasks] = await Promise.all([
    adminDb.collection(dealsCol(user.uid)).get(),
    adminDb.collection(salesCol(user.uid)).get(),
    adminDb.collection(tasksCol(user.uid)).get(),
  ]);
  const demoDeals = deals.docs.filter((d) => ids.has(d.get("vehicleId")));
  const dealIds = new Set(demoDeals.map((d) => d.id));
  const demoSales = sales.docs.filter((d) => ids.has(d.get("vehicleId")));
  const demoTasks = tasks.docs.filter((d) => ids.has(d.get("vehicleId")) || dealIds.has(d.get("dealId")));

  await deleteAll([...demoTasks, ...demoSales, ...demoDeals, ...demo.docs].map((d) => d.ref));
  // Photos uploaded to test cars while trying the system.
  await Promise.all(
    [...ids].map((id) => adminBucket().deleteFiles({ prefix: `${vehicleDoc(user.uid, id)}/` }).catch((e) => console.warn("demo photos cleanup", e))),
  );
  return NextResponse.json({ vehicles: ids.size, deals: demoDeals.length, sales: demoSales.length, tasks: demoTasks.length });
});
