import { Badge } from "@/components/ui/badge";

const LABELS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  scheduled: { label: "Programado", variant: "secondary" },
  publishing: { label: "Publicando", variant: "secondary" },
  published: { label: "Publicado", variant: "default" },
  partial: { label: "Parcial", variant: "destructive" },
  failed: { label: "Falló", variant: "destructive" },
  draft: { label: "Borrador", variant: "outline" },
  cancelled: { label: "Cancelado", variant: "outline" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = LABELS[status] ?? { label: status, variant: "outline" as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}
