// Grants (or removes) the SuperAdmin role: custom claim dfRole:"superadmin" on an existing Auth user.
// The person must have created their account in the app first (Crear cuenta).
// Usage (from the repo root):  node scripts/set-superadmin.mjs <email> [--remove]
// Credentials: GOOGLE_APPLICATION_CREDENTIALS (service account JSON of the kafona project)
// or `gcloud auth application-default login`.
import { createRequire } from "node:module";

const require = createRequire(new URL("../functions/package.json", import.meta.url));
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

const [email, flag] = process.argv.slice(2);
if (!email) throw new Error("Uso: node scripts/set-superadmin.mjs <email> [--remove]");
const PROJECT = process.env.PROJECT || "kafona";
// Local gcloud user credentials need a quota project for the Identity Toolkit API.
process.env.GOOGLE_CLOUD_QUOTA_PROJECT ||= PROJECT;

initializeApp({ credential: applicationDefault(), projectId: PROJECT });
const auth = getAuth();

let user;
try {
  user = await auth.getUserByEmail(email);
} catch (e) {
  if (e.code === "auth/user-not-found") {
    console.error(`No existe ${email} en ${PROJECT}. Créala primero en la app (Crear cuenta).`);
    process.exit(1);
  }
  throw e;
}

const claims = { ...(user.customClaims ?? {}) };
if (flag === "--remove") delete claims.dfRole;
else claims.dfRole = "superadmin";
await auth.setCustomUserClaims(user.uid, claims);
console.log(`${email} (${user.uid}): ${flag === "--remove" ? "ya no es SuperAdmin" : "ahora es SuperAdmin"}`);
