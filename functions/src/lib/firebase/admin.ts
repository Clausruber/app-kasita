import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

const app = getApps().length ? getApps()[0] : initializeApp();
export const adminAuth = getAuth(app);
export const adminDb = getFirestore(app);
export const adminBucket = () => getStorage(app).bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "kafona.firebasestorage.app");

