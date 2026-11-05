import { cn } from "@/lib/utils";

/** App logo (orange). Readable on light and dark backgrounds as is. */
export function BrandLogo({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/brand/logo-kasita.svg" alt={process.env.NEXT_PUBLIC_APP_NAME || "Kasita"} className={cn("h-6 w-auto", className)} />
  );
}
