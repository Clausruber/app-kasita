import { cn } from "@/lib/utils";

/** Autolix logo (navy). In dark mode it is drawn white so it stays readable. */
export function BrandLogo({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/brand/logo-autolix.svg" alt={process.env.NEXT_PUBLIC_APP_NAME || "Autolix"} className={cn("h-6 w-auto dark:brightness-0 dark:invert", className)} />
  );
}
