import * as crypto from "crypto";
import { defineSecret } from "firebase-functions/params";

// Same format as web/src/lib/ai-crypto.ts: base64(iv[12] | tag[16] | ciphertext).
export const DF_AI_ENCRYPTION_KEY = defineSecret("DF_AI_ENCRYPTION_KEY");

export function decrypt(payload: string): string {
  const buf = Buffer.from(payload, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(DF_AI_ENCRYPTION_KEY.value(), "hex"), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}
