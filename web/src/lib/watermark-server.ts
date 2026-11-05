import "server-only";

import sharp from "sharp";
import { HttpError } from "@/lib/auth-guard";
import { adminDb } from "@/lib/firebase/admin";
import { userDoc } from "@/lib/firebase/paths";
import { logoBox, normaliseImageSettings, type PostImageSettings } from "@/lib/watermark";
import { zernio } from "@/lib/zernio";

const MAX_BYTES = 15 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
const JPEG_QUALITY = 88;
// Images are only downloaded from where the app itself stores them (no arbitrary URLs: SSRF).
const ALLOWED_HOSTS = ["media.zernio.com", "firebasestorage.googleapis.com", "storage.googleapis.com"];

export type PostImagesResponse = PostImageSettings & { logoSource: "own" | "company" | "none"; companyLogoUrl: string };

export function isAllowedMediaUrl(raw: string) {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && (ALLOWED_HOSTS.includes(u.host) || u.host.endsWith(".zernio.com"));
  } catch {
    return false;
  }
}

/** Saved settings; without an own logo, the company logo (Ajustes → Empresa) is used. */
export async function readPostImages(uid: string): Promise<PostImagesResponse> {
  const snap = await adminDb.doc(userDoc(uid)).get();
  const own = (snap.get("postImages.logoUrl") as string | undefined) || "";
  const company = (snap.get("company.logoUrl") as string | undefined) || "";
  const s = normaliseImageSettings(snap.get("postImages") ?? {}, own || company);
  return { ...s, logoSource: own ? "own" : company ? "company" : "none", companyLogoUrl: company };
}

/** Downloads an image the app stores (allowed hosts only), at most 15 MB. Also used by the catalog PDF. */
export async function download(url: string, what: string) {
  if (!isAllowedMediaUrl(url)) throw new HttpError(400, `${what}: origen no permitido`);
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new HttpError(502, `${what}: no se pudo descargar (${res.status})`);
  if (Number(res.headers.get("content-length")) > MAX_BYTES) throw new HttpError(400, `${what}: pesa más de 15 MB`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new HttpError(400, `${what}: pesa más de 15 MB`);
  return buf;
}

/** Burns the logo into a copy of the photo (JPEG). The original is never modified. */
export async function renderWatermark(photo: Buffer, logo: Buffer, s: PostImageSettings) {
  // Apply EXIF rotation first so the box is computed on the photo as people see it.
  const base = await sharp(photo).rotate().toBuffer({ resolveWithObject: true });
  const meta = await sharp(logo).metadata();
  if (!meta.width || !meta.height) throw new Error("Logo sin dimensiones");
  const box = logoBox(base.info.width, base.info.height, meta.width, meta.height, s);
  const alpha = Math.round((255 * s.opacity) / 100);
  const mark = await sharp(logo)
    .resize(box.width, box.height, { fit: "fill" })
    .ensureAlpha()
    // Multiplies the logo's own alpha by the chosen opacity.
    .composite([{ input: Buffer.from([255, 255, 255, alpha]), raw: { width: 1, height: 1, channels: 4 }, tile: true, blend: "dest-in" }])
    .png()
    .toBuffer();
  return sharp(base.data)
    .composite([{ input: mark, left: Math.max(0, box.left), top: Math.max(0, box.top) }])
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
}

/** Uploads a rendered copy to Zernio's media storage, like the composer does from the browser. */
async function uploadToZernio(uid: string, data: Buffer, name: string) {
  const { uploadUrl, publicUrl } = await zernio<{ uploadUrl: string; publicUrl: string }>(uid, "/media/presign", {
    method: "POST",
    body: { filename: name, contentType: "image/jpeg", size: data.length },
  });
  const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: new Uint8Array(data) });
  if (!put.ok) throw new HttpError(502, `No se pudo subir la imagen con logo (${put.status})`);
  return publicUrl;
}

const isStill = (m: { url: string; type?: string }) => (m.type ?? "image") === "image" && !/\.gif(\?|$)/i.test(m.url);

/**
 * Replaces every still image of a post with a copy carrying the workspace logo. Videos and GIFs are
 * left as they are. Fails loudly: a post that asked for the logo is never published without it.
 */
export async function watermarkMedia(uid: string, media: { url: string; type?: string }[]) {
  const s = await readPostImages(uid);
  if (!s.logoUrl) throw new HttpError(400, "No hay logo configurado: súbelo en Ajustes → Imágenes");
  if (!media.some(isStill)) return media;
  const logo = await download(s.logoUrl, "Logo");
  return Promise.all(
    media.map(async (m, i) => {
      if (!isStill(m)) return m;
      try {
        const out = await renderWatermark(await download(m.url, `Imagen ${i + 1}`), logo, s);
        return { ...m, url: await uploadToZernio(uid, out, `logo-${Date.now()}-${i + 1}.jpg`), type: "image" };
      } catch (e) {
        if (e instanceof HttpError) throw e;
        throw new HttpError(502, `No se pudo aplicar el logo a la imagen ${i + 1}: ${(e as Error).message}`);
      }
    }),
  );
}
