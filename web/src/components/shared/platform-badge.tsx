import { platformColor, platformName } from "@/lib/platforms";
import { cn } from "@/lib/utils";

export function PlatformBadge({ platform, className }: { platform: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", className)}>
      <span className="size-2 rounded-full" style={{ background: platformColor(platform) }} />
      {platformName(platform)}
    </span>
  );
}
