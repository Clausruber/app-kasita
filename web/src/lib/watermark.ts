// Where the logo goes on a post photo (Ajustes → Imágenes). Pure: shared by the browser preview
// (CSS overlay) and the server render (sharp, lib/watermark-server.ts), so the preview matches the post.

export const LOGO_POSITIONS = ["tl", "tc", "tr", "ml", "mc", "mr", "bl", "bc", "br"] as const;
export type LogoPosition = (typeof LOGO_POSITIONS)[number];

export type PostImageSettings = {
  logoUrl: string; // "" = none
  position: LogoPosition;
  sizePct: number; // logo width, % of the photo width
  opacity: number; // 10–100
  marginPct: number; // distance to the edges, % of each side
  defaultOn: boolean; // "Agregar logo" starts on in the composer
};

export const IMAGE_DEFAULTS: Omit<PostImageSettings, "logoUrl"> = { position: "br", sizePct: 18, opacity: 85, marginPct: 3, defaultOn: true };
export const SIZE_RANGE = [8, 40] as const;
export const OPACITY_RANGE = [10, 100] as const;
export const MARGIN_RANGE = [0, 10] as const;
const MAX_LOGO_HEIGHT = 0.9; // a tall logo never covers the whole photo

const clamp = (n: number, [min, max]: readonly [number, number]) => Math.min(max, Math.max(min, n));

/** Fills missing/invalid fields with the defaults (stored docs and API input). */
export function normaliseImageSettings(v: Partial<Record<keyof PostImageSettings, unknown>> | undefined, fallbackLogo = ""): PostImageSettings {
  const num = (x: unknown, d: number, r: readonly [number, number]) => (Number.isFinite(Number(x)) && x !== null && x !== "" ? clamp(Math.round(Number(x)), r) : d);
  return {
    logoUrl: typeof v?.logoUrl === "string" && v.logoUrl ? v.logoUrl : fallbackLogo,
    position: LOGO_POSITIONS.includes(v?.position as LogoPosition) ? (v!.position as LogoPosition) : IMAGE_DEFAULTS.position,
    sizePct: num(v?.sizePct, IMAGE_DEFAULTS.sizePct, SIZE_RANGE),
    opacity: num(v?.opacity, IMAGE_DEFAULTS.opacity, OPACITY_RANGE),
    marginPct: num(v?.marginPct, IMAGE_DEFAULTS.marginPct, MARGIN_RANGE),
    defaultOn: typeof v?.defaultOn === "boolean" ? v.defaultOn : IMAGE_DEFAULTS.defaultOn,
  };
}

/** Logo box in pixels on a `imgW`×`imgH` photo, for a logo of `logoW`×`logoH`. */
export function logoBox(imgW: number, imgH: number, logoW: number, logoH: number, s: Pick<PostImageSettings, "position" | "sizePct" | "marginPct">) {
  let width = (imgW * s.sizePct) / 100;
  let height = (width * logoH) / logoW;
  if (height > imgH * MAX_LOGO_HEIGHT) {
    height = imgH * MAX_LOGO_HEIGHT;
    width = (height * logoW) / logoH;
  }
  const mx = (imgW * s.marginPct) / 100;
  const my = (imgH * s.marginPct) / 100;
  const [v, h] = s.position;
  const left = h === "l" ? mx : h === "c" ? (imgW - width) / 2 : imgW - width - mx;
  const top = v === "t" ? my : v === "m" ? (imgH - height) / 2 : imgH - height - my;
  return { left: Math.round(left), top: Math.round(top), width: Math.round(width), height: Math.round(height) };
}

/** Same placement as CSS for an overlay <img> inside a relative box the size of the photo. */
export function logoStyle(s: Pick<PostImageSettings, "position" | "sizePct" | "marginPct" | "opacity">) {
  const [v, h] = s.position;
  const m = `${s.marginPct}%`;
  return {
    position: "absolute" as const,
    width: `${s.sizePct}%`,
    maxHeight: `${MAX_LOGO_HEIGHT * 100}%`,
    objectFit: "contain" as const,
    opacity: s.opacity / 100,
    ...(h === "l" ? { left: m } : h === "r" ? { right: m } : { left: "50%" }),
    ...(v === "t" ? { top: m } : v === "b" ? { bottom: m } : { top: "50%" }),
    transform: `translate(${h === "c" ? "-50%" : "0"}, ${v === "m" ? "-50%" : "0"})`,
    pointerEvents: "none" as const,
  };
}

export const POSITION_LABEL: Record<LogoPosition, string> = {
  tl: "Arriba a la izquierda",
  tc: "Arriba al centro",
  tr: "Arriba a la derecha",
  ml: "Centro a la izquierda",
  mc: "Centro",
  mr: "Centro a la derecha",
  bl: "Abajo a la izquierda",
  bc: "Abajo al centro",
  br: "Abajo a la derecha",
};
