"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Heart, MessageCircle, Plus } from "lucide-react";
import { usePosts } from "@/hooks/use-firestore";
import type { Post } from "@/lib/types";
import { PlatformBadge } from "@/components/shared/platform-badge";
import { PostDetail } from "@/components/posts/post-detail";
import { StatusBadge } from "@/components/posts/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCan } from "@/hooks/use-me";

type Filter = "all" | "scheduled" | "published" | "failed";
const FILTERS: { id: Filter; label: string; match: (p: Post) => boolean }[] = [
  { id: "all", label: "Todas", match: () => true },
  { id: "scheduled", label: "Programadas", match: (p) => ["scheduled", "publishing", "draft"].includes(p.status) },
  { id: "published", label: "Publicadas", match: (p) => p.status === "published" },
  { id: "failed", label: "Con errores", match: (p) => ["failed", "partial"].includes(p.status) },
];

/** Posts created in this app (newest first), with a button to create a new one. */
export default function PostsPage() {
  const { data, loading, error } = usePosts();
  const [filter, setFilter] = useState<Filter>("all");
  const canCreate = useCan()("posts.create");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Posts published outside the app only exist here as inbox stubs: not listed.
  const posts = useMemo(() => data.filter((p) => p.source !== "external").sort((a, b) => b.scheduledFor.toMillis() - a.scheduledFor.toMillis()), [data]);
  const visible = posts.filter(FILTERS.find((f) => f.id === filter)!.match);
  const selected = posts.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-semibold">
          Publicaciones {posts.length > 0 && <span className="text-base font-normal text-muted-foreground">· {posts.length}</span>}
        </h1>
        {canCreate && (
          <Link href="/dashboard/posts/new" className={buttonVariants()}>
            <Plus /> Nueva publicación
          </Link>
        )}
      </div>

      <div className="flex w-fit flex-wrap rounded-lg border p-0.5">
        {FILTERS.map((f) => (
          <Button key={f.id} size="sm" variant={filter === f.id ? "secondary" : "ghost"} onClick={() => setFilter(f.id)}>
            {f.label} <span className="text-muted-foreground">{posts.filter(f.match).length}</span>
          </Button>
        ))}
      </div>

      {error && <p className="text-sm text-destructive">{error.message}</p>}
      {loading && <p className="text-sm text-muted-foreground">Cargando…</p>}
      {!loading && !visible.length && (
        <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          {posts.length ? "No hay publicaciones con este filtro." : "Aún no has creado ninguna publicación."}
          {!posts.length && canCreate && (
            <div className="mt-3">
              <Link href="/dashboard/posts/new" className={buttonVariants({ size: "sm" })}>
                <Plus /> Crear la primera
              </Link>
            </div>
          )}
        </div>
      )}

      <ul className="space-y-2">
        {visible.map((p) => {
          const thumb = p.picture || p.mediaItems?.find((m) => m.type !== "video")?.url;
          return (
            <li key={p.id}>
              <button
                onClick={() => setSelectedId(p.id)}
                className={cn("flex w-full gap-3 rounded-xl border p-3 text-left transition-colors hover:bg-muted/50", p.id === selectedId && "border-primary")}
              >
                {thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumb} alt="" className="size-16 shrink-0 rounded-lg object-cover" />
                ) : (
                  <div className="size-16 shrink-0 rounded-lg bg-muted" />
                )}
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={p.status} />
                    <span className="text-xs text-muted-foreground">
                      {p.status === "published" ? "Publicado" : "Programado"} · {format(p.scheduledFor.toDate(), "d MMM yyyy, HH:mm", { locale: es })}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-sm">{p.content || "(solo media)"}</p>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    {p.platforms.map((t, i) => (
                      <PlatformBadge key={`${t.platform}-${i}`} platform={t.platform} className={cn(t.status === "failed" && "text-destructive")} />
                    ))}
                    {(p.likeCount ?? 0) > 0 && (
                      <span className="flex items-center gap-0.5">
                        <Heart className="size-3" /> {p.likeCount}
                      </span>
                    )}
                    {(p.commentCount ?? 0) > 0 && (
                      <span className="flex items-center gap-0.5">
                        <MessageCircle className="size-3" /> {p.commentCount}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      {selected && <PostDetail key={selected.id} post={selected} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
