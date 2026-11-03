import { statusLabel } from "@/lib/vehicle-catalog";
import type { VehicleStatus } from "@/lib/types";
import { Badge } from "@/components/ui/badge";

const STATUS_STYLE: Record<VehicleStatus, string> = {
  borrador: "bg-muted text-muted-foreground",
  disponible: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  apartado: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  vendido: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
};

export function StatusBadge({ status }: { status: VehicleStatus }) {
  return <Badge className={STATUS_STYLE[status]}>{statusLabel(status)}</Badge>;
}
