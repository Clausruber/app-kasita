// Sends a signed fake Zernio webhook to the local functions emulator.
// Usage: node scripts/test-webhook.mjs <uid> [commentId] [event]
// Seeds DEMO-FIREBASE/_system/zernioAccounts/acc_test -> uid in the Firestore emulator first.
import crypto from "node:crypto";

const [uid, commentId = "c_" + Date.now(), event = "comment.received"] = process.argv.slice(2);
if (!uid) throw new Error("uid required");
const PROJECT = process.env.PROJECT || "demo-social";
const SECRET = process.env.ZERNIO_WEBHOOK_SECRET || "test-secret";
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;

await fetch(`${FS}/DEMO-FIREBASE/_system/zernioAccounts/acc_test`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json", Authorization: "Bearer owner" },
  body: JSON.stringify({ fields: { uid: { stringValue: uid }, platform: { stringValue: "instagram" } } }),
});

const payload = {
  id: "evt_" + commentId,
  event,
  timestamp: new Date().toISOString(),
  comment: {
    id: commentId,
    postId: "zp_external_1",
    platformPostId: "ig_123",
    platform: "instagram",
    text: process.env.TEXT || "¡Me encanta este post! ¿Cuándo sale el siguiente?",
    author: { id: "u1", username: "ana.lopez", name: "Ana López", picture: null },
    createdAt: new Date().toISOString(),
    isReply: false,
    parentCommentId: null,
  },
  post: { id: "zp_external_1", platformPostId: "ig_123", content: "Nuestro lanzamiento de otoño 🍂", permalink: "https://instagram.com/p/ig_123" },
  account: { id: "acc_test", accountId: "acc_test", platform: "instagram", username: "mi_marca" },
};
const body = JSON.stringify(payload);
const sig = crypto.createHmac("sha256", SECRET).update(body).digest("hex");
const res = await fetch(`http://127.0.0.1:5001/${PROJECT}/us-central1/dfZernioWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Zernio-Signature": sig },
  body,
});
console.log(res.status, await res.text());
