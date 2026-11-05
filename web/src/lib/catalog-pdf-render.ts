import "server-only";

import { createElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import QRCode from "qrcode";
import sharp from "sharp";
import type { ReactElement } from "react";
import { CatalogPdf, type PdfAssets, type PdfCompany } from "@/components/quotes/catalog-pdf";
import { formatAddress, type Company } from "@/lib/company";
import { adminDb } from "@/lib/firebase/admin";
import { userDoc } from "@/lib/firebase/paths";
import type { QuoteDoc } from "@/lib/quotes-server";
import { download, readPostImages } from "@/lib/watermark-server";

const PHOTO_SIDE = 1000;
const LOGO_SIDE = 400;

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    console.warn("catalog asset", (e as Error).message);
    return null;
  }
}

/** Downloads and shrinks every photo (JPEG 1000 px) and the logo (PNG): keeps the PDF small. */
async function loadAssets(uid: string, q: QuoteDoc, link: string | null): Promise<PdfAssets> {
  const urls = [...new Set(q.properties.flatMap((v) => v.photos))];
  const { logoUrl } = await readPostImages(uid);
  const [logo, ...photos] = await Promise.all([
    logoUrl ? safe(download(logoUrl, "Logo").then((b) => sharp(b).resize(LOGO_SIDE, LOGO_SIDE, { fit: "inside", withoutEnlargement: true }).png().toBuffer())) : null,
    ...urls.map((u) =>
      safe(download(u, "Foto").then((b) => sharp(b).rotate().resize(PHOTO_SIDE, PHOTO_SIDE, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 78, mozjpeg: true }).toBuffer())),
    ),
  ]);
  const qr = link ? await QRCode.toBuffer(link, { type: "png", margin: 1, width: 240, errorCorrectionLevel: "M" }) : null;
  return { logo, photos: Object.fromEntries(urls.flatMap((u, i) => (photos[i] ? [[u, photos[i]!]] : []))), link, qr };
}

async function loadCompany(uid: string): Promise<PdfCompany> {
  const c = ((await adminDb.doc(userDoc(uid)).get()).get("company") ?? {}) as Partial<Company>;
  return {
    name: c.name ?? "",
    address: c.address ? formatAddress(c.address) : "",
    phone: c.phone ?? "",
    whatsapp: c.whatsapp ?? "",
    email: c.email ?? "",
    website: c.website ?? "",
  };
}

/** `link`: the public page of the quote, printed with a QR so the PDF leads back to it. */
export async function renderCatalogPdf(uid: string, q: QuoteDoc, link: string | null = null) {
  const [assets, company] = await Promise.all([loadAssets(uid, q, link), loadCompany(uid)]);
  const doc = createElement(CatalogPdf, { q, company, assets }) as unknown as ReactElement<DocumentProps>;
  return renderToBuffer(doc);
}
