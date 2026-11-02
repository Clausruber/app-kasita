import "server-only";

import crypto from "crypto";

// AES-256-GCM for the user's OpenRouter key at rest. Same format as functions/src/crypto.ts:
// base64(iv[12] | tag[16] | ciphertext). DF_AI_ENCRYPTION_KEY is 32 bytes as hex.
function key() {
  const hex = process.env.DF_AI_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) throw new Error("DF_AI_ENCRYPTION_KEY no está configurada");
  return Buffer.from(hex, "hex");
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}

export function decrypt(payload: string): string {
  const buf = Buffer.from(payload, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}
