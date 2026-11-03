"use client";

import { logoStyle, type PostImageSettings } from "@/lib/watermark";
import { cn } from "@/lib/utils";

/**
 * A photo with the logo overlaid exactly where the server will burn it in (same geometry as
 * lib/watermark.ts). The box takes the photo's own aspect ratio, so the overlay lines up.
 */
export function WatermarkedImage({
  src,
  alt = "",
  logo,
  className,
  imgClassName,
}: {
  src: string;
  alt?: string;
  logo: PostImageSettings | null; // null = no logo
  className?: string;
  imgClassName?: string;
}) {
  return (
    <div className={cn("relative overflow-hidden", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className={cn("block h-auto w-full", imgClassName)} />
      {logo?.logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo.logoUrl} alt="" aria-hidden style={logoStyle(logo)} />
      )}
    </div>
  );
}
