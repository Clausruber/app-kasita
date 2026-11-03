import "server-only";

import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

function createApp(): App {
  // Look for the default app only: on Firebase Hosting the frameworks runtime creates its own named app.
  const existing = getApps().find((a) => a.name === "[DEFAULT]");
  if (existing) return existing;
  // On Firebase App Hosting / emulators, application default credentials are used.
  // Locally against a real project, set FIREBASE_SERVICE_ACCOUNT to the JSON key.
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  return initializeApp(
    sa
      ? { credential: cert(JSON.parse(sa)) }
      : { projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID },
  );
}

const app = createApp();
export const adminAuth = getAuth(app);
export const adminDb = getFirestore(app);
/** Bucket holding vehicle photos (paths under app-autolix-prod/{uid}/vehicles/…). */
export const adminBucket = () => getStorage(app).bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);
